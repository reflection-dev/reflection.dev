#!/usr/bin/env node
/**
 * Fetch nixops docs into src/docs/nixops/.
 *
 * Source of truth for structure (sections, ordering) is `docs/sections.json`
 * inside the nixops repo. This site only renders what the source declares --
 * no slug-lists live here.
 *
 * Source resolution order:
 *   1. NIXOPS_DOCS env var (absolute path to a checked-out docs/ dir)
 *   2. ../nixops/docs/ (local sibling checkout, dev convenience)
 *   3. shallow git clone of github:reflection-dev/nixops (CI / Cloudflare)
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEST = join(ROOT, "src", "docs", "nixops");
const NIXOPS_REPO = "https://github.com/reflection-dev/nixops.git";
const MANIFEST = "sections.json";

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

function loadManifest(docsPath) {
  const p = join(docsPath, MANIFEST);
  if (!existsSync(p)) {
    throw new Error(
      `[fetch-docs] ${MANIFEST} missing in ${docsPath} -- add it to declare ` +
        `section grouping and page order (see reflection.dev README).`
    );
  }
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`[fetch-docs] ${MANIFEST} must be an array of sections`);
  }
  return parsed;
}

function slugFor(filename) {
  // "07-nixos-anywhere.md" → "nixos-anywhere"
  // "00-index.md" → "index" (special-cased downstream)
  const m = filename.match(/^(?:\d+[-_.])?(.+)\.md$/);
  if (!m) throw new Error(`Cannot derive slug from ${filename}`);
  return m[1];
}

function tidyTitle(raw) {
  return raw.trim().replace(/^\d+\s*[-–—]{1,2}\s*/, "").replace(/--/g, "—");
}

function rewriteLinks(body, docs) {
  return body.replace(
    /\]\(([^)]+?)\.md(#[^)]*)?\)/gi,
    (whole, ref, anchor) => {
      const target = docs.find((d) => d.filename === `${ref}.md`);
      if (!target) return whole;
      return `](${target.permalink}${anchor ?? ""})`;
    }
  );
}

function main() {
  const src = resolveSource();
  console.log(`[fetch-docs] source: ${src.origin} (${src.path})`);

  const manifest = loadManifest(src.path);

  // Flatten manifest into an ordered doc list with section metadata.
  const docs = [];
  let globalOrder = 0;
  manifest.forEach((section, sectionOrder) => {
    if (!section.name || !Array.isArray(section.docs)) {
      throw new Error(
        `[fetch-docs] section entry must be {name, docs: [...]}, got ${JSON.stringify(section)}`
      );
    }
    section.docs.forEach((filename) => {
      const srcFile = join(src.path, filename);
      if (!existsSync(srcFile)) {
        throw new Error(
          `[fetch-docs] ${MANIFEST} lists ${filename}, but ${srcFile} is missing`
        );
      }
      const slug = slugFor(filename);
      const isIndex = slug === "index";
      docs.push({
        filename,
        slug,
        isIndex,
        section: { name: section.name, order: sectionOrder },
        order: globalOrder++,
        permalink: isIndex ? "/docs/nixops/" : `/docs/nixops/${slug}/`,
        raw: readFileSync(srcFile, "utf8"),
      });
    });
  });

  // Warn on stray .md files that exist but aren't declared -- helps catch
  // manifest drift after a rename.
  const declared = new Set(docs.map((d) => d.filename));
  const stray = readdirSync(src.path)
    .filter((f) => f.endsWith(".md") && !declared.has(f));
  if (stray.length) {
    console.warn(
      `[fetch-docs] warning: ${stray.length} .md file(s) in ${src.path} not in ${MANIFEST}: ` +
        stray.join(", ")
    );
  }

  // Compute titles from H1.
  for (const doc of docs) {
    const h1 = doc.raw.match(/^#\s+(.+?)\s*$/m);
    doc.title = tidyTitle(h1 ? h1[1] : doc.slug);
  }

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
  console.log(
    `[fetch-docs] wrote ${docs.length} files (${manifest.length} sections) to ${DEST}`
  );
}

main();
