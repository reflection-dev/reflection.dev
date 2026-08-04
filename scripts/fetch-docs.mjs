#!/usr/bin/env node
/**
 * Fetch nixops docs into src/docs/nixops/.
 *
 * Source resolution order:
 *   1. NIXOPS_DOCS env var (absolute path to a checked-out docs/ dir)
 *   2. ../nixops/docs/ (local sibling checkout, dev convenience)
 *   3. shallow git clone of github:reflection-dev/nixops (CI / Cloudflare Pages)
 *
 * For each source .md we inject YAML front matter (title, order, permalink,
 * layout) so 11ty renders it under /docs/nixops/{slug}/.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEST = join(ROOT, "src", "docs", "nixops");
const NIXOPS_REPO = "https://github.com/reflection-dev/nixops.git";

function resolveSource() {
  if (process.env.NIXOPS_DOCS) {
    const p = resolve(process.env.NIXOPS_DOCS);
    if (!existsSync(p)) throw new Error(`NIXOPS_DOCS=${p} does not exist`);
    return { path: p, cleanup: null, origin: "NIXOPS_DOCS" };
  }

  const sibling = resolve(ROOT, "..", "nixops", "docs");
  if (existsSync(sibling)) {
    return { path: sibling, cleanup: null, origin: "sibling ../nixops/docs" };
  }

  const tmp = mkdtempSync(join(tmpdir(), "nixops-docs-"));
  console.log(`[fetch-docs] cloning ${NIXOPS_REPO} into ${tmp}`);
  execSync(`git clone --depth 1 --filter=blob:none ${NIXOPS_REPO} ${tmp}`, {
    stdio: "inherit",
  });
  return {
    path: join(tmp, "docs"),
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
    origin: `git clone ${NIXOPS_REPO}`,
  };
}

function parseFile(name, raw) {
  // Filename like "07-nixos-anywhere.md"  →  order=7, slug="nixos-anywhere".
  // Filename "00-index.md" is the section index → permalink /docs/nixops/.
  const m = name.match(/^(\d+)[-_.]?(.*)\.md$/);
  if (!m) throw new Error(`Cannot parse nixops doc filename: ${name}`);
  const order = Number(m[1]);
  const slug = m[2] || "index";

  // Extract H1 as title. Strip a leading "NN -- " if present.
  const h1 = raw.match(/^#\s+(.+?)\s*$/m);
  let title = h1 ? h1[1].trim() : slug;
  title = title.replace(/^\d+\s*[-–—]{1,2}\s*/, "");

  const isIndex = slug === "index";
  const permalink = isIndex ? "/docs/nixops/" : `/docs/nixops/${slug}/`;

  return { order, slug, title, permalink, isIndex };
}

function rewriteLinks(body, docs) {
  // Turn cross-links like [text](07-nixos-anywhere.md) or (07-nixos-anywhere.md#x)
  // into site-relative permalinks. Passthrough anything else (external, anchors).
  return body.replace(
    /\]\((\d+[-_.][a-z0-9-_]+|00-index)\.md(#[^)]*)?\)/gi,
    (_, filename, anchor) => {
      const target = docs.find((d) => d.sourceBase === filename);
      if (!target) return `](${filename}.md${anchor ?? ""})`;
      return `](${target.permalink}${anchor ?? ""})`;
    }
  );
}

function main() {
  const src = resolveSource();
  console.log(`[fetch-docs] source: ${src.origin} (${src.path})`);

  const files = readdirSync(src.path)
    .filter((f) => /^\d+[-_.].*\.md$/.test(f))
    .sort();

  if (!files.length) throw new Error(`No matching docs in ${src.path}`);

  const docs = files.map((f) => {
    const raw = readFileSync(join(src.path, f), "utf8");
    const meta = parseFile(f, raw);
    return { ...meta, sourceBase: f.replace(/\.md$/, ""), raw };
  });

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });

  for (const doc of docs) {
    const body = rewriteLinks(doc.raw, docs);
    // Drop the raw H1 -- the layout renders `title` on its own to control
    // spacing and header-anchor behaviour.
    const bodyNoH1 = body.replace(/^#\s+.+?\n+/m, "");
    const frontmatter = [
      "---",
      `title: ${JSON.stringify(doc.title)}`,
      `order: ${doc.order}`,
      `permalink: ${doc.permalink}`,
      `layout: layouts/doc.njk`,
      `tags: nixops-docs`,
      "---",
      "",
    ].join("\n");
    const destName = doc.isIndex ? "index.md" : `${doc.slug}.md`;
    writeFileSync(join(DEST, destName), frontmatter + bodyNoH1);
  }

  if (src.cleanup) src.cleanup();
  console.log(`[fetch-docs] wrote ${docs.length} files to ${DEST}`);
}

main();
