#!/usr/bin/env node
/**
 * Fetch nixops docs into src/docs/nixops/.
 *
 * Structure comes from a single `docs/_meta.json` in the nixops repo,
 * with section slug as key and {title, pages} as value. Key order = section
 * order in the sidebar; `pages` order = order within the section.
 *
 *   {
 *     "foundations": {
 *       "title": "Foundations",
 *       "pages": ["what-is-nix", "install-nix", ...]
 *     },
 *     ...
 *   }
 *
 * Page title lives inside each page's own YAML front matter (`title:`),
 * so the label is edited in one place next to the content it describes.
 *
 * Source resolution order:
 *   1. NIXOPS_DOCS env var (absolute path to a checked-out docs/ dir)
 *   2. ../nixops/docs/ (local sibling checkout, dev convenience)
 *   3. shallow git clone of github:reflection-dev/nixops (CI / Cloudflare)
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEST = join(ROOT, "src", "docs", "nixops");
const NIXOPS_REPO = "https://github.com/reflection-dev/nixops.git";
const URL_BASE = "/docs/nixops";

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

function loadManifest(srcRoot) {
  const p = join(srcRoot, "_meta.json");
  if (!existsSync(p)) {
    throw new Error(`[fetch-docs] missing _meta.json in ${srcRoot}`);
  }
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `[fetch-docs] _meta.json must be an object of {sectionSlug: {title, pages}}`
    );
  }
  // Normalise to an ordered array of {slug, title, pages}. JSON key order is
  // preserved by V8, so section order == file order.
  return Object.entries(parsed).map(([slug, value]) => {
    if (!value || typeof value !== "object" || !value.title || !Array.isArray(value.pages)) {
      throw new Error(
        `[fetch-docs] section "${slug}" needs {title, pages}: ${JSON.stringify(value)}`
      );
    }
    return { slug, title: value.title, pages: value.pages };
  });
}

function buildPages(srcRoot) {
  const sections = loadManifest(srcRoot);
  const pages = [];
  let globalOrder = 0;

  sections.forEach((section, sectionOrder) => {
    section.pages.forEach((pageSlug) => {
      const file = join(srcRoot, section.slug, `${pageSlug}.md`);
      if (!existsSync(file)) {
        throw new Error(
          `[fetch-docs] _meta.json section "${section.slug}" lists "${pageSlug}" but ${file} is missing`
        );
      }
      const raw = readFileSync(file, "utf8");
      const parsed = matter(raw);
      const title = parsed.data.title;
      if (!title) {
        throw new Error(
          `[fetch-docs] ${section.slug}/${pageSlug}.md has no title: in front matter`
        );
      }
      const isSectionIndex = pageSlug === "index" && section.slug === "overview";
      const permalink = isSectionIndex
        ? `${URL_BASE}/`
        : `${URL_BASE}/${section.slug}/${pageSlug}/`;
      pages.push({
        sectionSlug: section.slug,
        sectionTitle: section.title,
        sectionOrder,
        slug: pageSlug,
        title,
        time: parsed.data.time ?? null,
        order: globalOrder++,
        isSectionIndex,
        permalink,
        body: parsed.content,
      });
    });
  });

  return { sections, pages };
}

function rewriteLinks(body, currentSection, allPages) {
  return body.replace(
    /\]\(((?:\.\.\/)?[a-z0-9-_]+\/)?([a-z0-9-_]+)\.md(#[^)]*)?\)/gi,
    (whole, prefix, slug, anchor) => {
      const targetSection = prefix
        ? prefix.replace(/[./]/g, "").replace(/^\.\.$/, "")
        : currentSection;
      const target = allPages.find(
        (p) => p.slug === slug && p.sectionSlug === targetSection
      );
      if (!target) return whole;
      return `](${target.permalink}${anchor ?? ""})`;
    }
  );
}

function yamlValue(v) {
  return JSON.stringify(v);
}

function main() {
  const src = resolveSource();
  console.log(`[fetch-docs] source: ${src.origin} (${src.path})`);

  const { sections, pages } = buildPages(src.path);

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });

  for (const page of pages) {
    const body = rewriteLinks(page.body, page.sectionSlug, pages)
      .replace(/^#\s+.+?\n+/m, ""); // strip raw H1 -- layout renders `title` on its own

    const fm = [
      "---",
      `title: ${yamlValue(page.title)}`,
      `section: ${yamlValue(page.sectionTitle)}`,
      `sectionSlug: ${yamlValue(page.sectionSlug)}`,
      `sectionOrder: ${page.sectionOrder}`,
      `order: ${page.order}`,
      `permalink: ${page.permalink}`,
      `layout: doc.njk`,
      `tags: nixops-docs`,
    ];
    if (page.time) fm.push(`time: ${yamlValue(page.time)}`);
    fm.push("---", "");

    const destPath = page.isSectionIndex
      ? join(DEST, "index.md")
      : join(DEST, page.sectionSlug, `${page.slug}.md`);
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, fm.join("\n") + body);
  }

  if (src.cleanup) src.cleanup();
  console.log(
    `[fetch-docs] wrote ${pages.length} pages across ${sections.length} sections to ${DEST}`
  );
}

main();
