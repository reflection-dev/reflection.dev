#!/usr/bin/env node
/**
 * Fetch nixops docs into src/docs/nixops/.
 *
 * Source resolution order:
 *   1. NIXOPS_DOCS env var (absolute path to a checked-out docs/ dir)
 *   2. ../nixops/docs/ (local sibling checkout, dev convenience)
 *   3. shallow git clone of github:reflection-dev/nixops (CI / Cloudflare)
 *
 * For each source .md we inject YAML front matter (title, order, section,
 * permalink, layout, tags) so 11ty renders it under /docs/nixops/{slug}/.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEST = join(ROOT, "src", "docs", "nixops");
const NIXOPS_REPO = "https://github.com/reflection-dev/nixops.git";

// Sections group the sidebar. Order in this array is display order.
// Each entry lists the source basenames (without the `.md` and numeric prefix)
// that belong to that section.
const SECTIONS = [
  {
    name: "Overview",
    slugs: ["index"],
  },
  {
    name: "Foundations",
    slugs: [
      "what-is-nix",
      "install-nix",
      "nix-language",
      "flakes",
      "nixos-and-modules",
    ],
  },
  {
    name: "Deploying",
    slugs: [
      "sops-nix",
      "nixos-anywhere",
      "deploy-rs",
      "your-first-fleet",
      "anatomy-of-an-instance",
    ],
  },
  {
    name: "Operating",
    slugs: [
      "day-two-operations",
      "writing-host-modules",
      "troubleshooting",
      "further-reading",
    ],
  },
];

function sectionFor(slug) {
  for (let i = 0; i < SECTIONS.length; i++) {
    if (SECTIONS[i].slugs.includes(slug)) {
      return { name: SECTIONS[i].name, order: i };
    }
  }
  throw new Error(
    `No section mapping for slug "${slug}" -- add it to SECTIONS in scripts/fetch-docs.mjs`
  );
}

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
  const docsPath = join(tmp, "docs");
  if (!existsSync(docsPath)) {
    throw new Error(
      `[fetch-docs] cloned ${NIXOPS_REPO} but docs/ is missing -- ` +
        `did you forget to commit and push nixops/docs?`
    );
  }
  return {
    path: docsPath,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
    origin: `git clone ${NIXOPS_REPO}`,
  };
}

function tidyTitle(raw) {
  // "01 -- What Nix is and why it matters" → "What Nix is and why it matters"
  // "nixops -- Nix for Ops: a zero-to-fleet tutorial" is left as-is.
  return raw.trim().replace(/^\d+\s*[-–—]{1,2}\s*/, "").replace(/--/g, "—");
}

function parseFile(name, raw) {
  const m = name.match(/^(\d+)[-_.]?(.*)\.md$/);
  if (!m) throw new Error(`Cannot parse nixops doc filename: ${name}`);
  const order = Number(m[1]);
  const slug = m[2] || "index";

  const h1 = raw.match(/^#\s+(.+?)\s*$/m);
  const title = tidyTitle(h1 ? h1[1] : slug);

  const isIndex = slug === "index";
  const permalink = isIndex ? "/docs/nixops/" : `/docs/nixops/${slug}/`;
  const section = sectionFor(slug);

  return { order, slug, title, permalink, isIndex, section };
}

function rewriteLinks(body, docs) {
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
    const body = rewriteLinks(doc.raw, docs).replace(/^#\s+.+?\n+/m, "");
    const frontmatter = [
      "---",
      `title: ${JSON.stringify(doc.title)}`,
      `order: ${doc.order}`,
      `section: ${JSON.stringify(doc.section.name)}`,
      `sectionOrder: ${doc.section.order}`,
      `permalink: ${doc.permalink}`,
      `layout: doc.njk`,
      `tags: nixops-docs`,
      "---",
      "",
    ].join("\n");
    const destName = doc.isIndex ? "index.md" : `${doc.slug}.md`;
    writeFileSync(join(DEST, destName), frontmatter + body);
  }

  if (src.cleanup) src.cleanup();
  console.log(`[fetch-docs] wrote ${docs.length} files to ${DEST}`);
}

main();
