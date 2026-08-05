#!/usr/bin/env node
/**
 * Fetch nixops docs into src/docs/nixops/.
 *
 * Structure and ordering come from the nixops repo itself: `_meta.json`
 * files at each folder level declare label + order of children (Nextra
 * convention). Per-page `prereq/time/outcome` live in each doc's own
 * YAML front matter.
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
const META = "_meta.json";
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

function loadMeta(dir) {
  const p = join(dir, META);
  if (!existsSync(p)) {
    throw new Error(`[fetch-docs] missing ${META} in ${dir}`);
  }
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`[fetch-docs] ${p} must be a JSON object of {key: label}`);
  }
  return parsed;
}

function buildPages(srcRoot) {
  const rootMeta = loadMeta(srcRoot);
  const sections = [];
  let globalOrder = 0;
  let sectionOrder = 0;
  const pages = [];

  for (const [sectionSlug, sectionLabel] of Object.entries(rootMeta)) {
    const sectionDir = join(srcRoot, sectionSlug);
    if (!existsSync(sectionDir)) {
      throw new Error(
        `[fetch-docs] section "${sectionSlug}" declared in root ${META} but ${sectionDir} does not exist`
      );
    }
    const pageMeta = loadMeta(sectionDir);
    sections.push({ slug: sectionSlug, label: sectionLabel, order: sectionOrder++ });

    for (const [pageSlug, pageLabel] of Object.entries(pageMeta)) {
      const file = join(sectionDir, `${pageSlug}.md`);
      if (!existsSync(file)) {
        throw new Error(
          `[fetch-docs] ${META} in ${sectionSlug}/ lists "${pageSlug}" but ${file} is missing`
        );
      }
      const isSectionIndex = pageSlug === "index" && sectionSlug === "overview";
      // Overview/index becomes the docs root landing.
      const permalink = isSectionIndex
        ? `${URL_BASE}/`
        : `${URL_BASE}/${sectionSlug}/${pageSlug}/`;
      pages.push({
        sectionSlug,
        sectionLabel,
        sectionOrder: sectionOrder - 1,
        slug: pageSlug,
        title: pageLabel,
        order: globalOrder++,
        isSectionIndex,
        file,
        permalink,
      });
    }
  }
  return { sections, pages };
}

function rewriteLinks(body, currentSection, allPages) {
  // Turn source-relative links (`../foundations/what-is-nix.md` or
  // `what-is-nix.md`) into site-relative permalinks.
  return body.replace(
    /\]\(((?:\.\.\/)?[a-z0-9-_]+\/)?([a-z0-9-_]+)\.md(#[^)]*)?\)/gi,
    (whole, prefix, slug, anchor) => {
      let targetSection;
      if (!prefix) targetSection = currentSection;
      else targetSection = prefix.replace(/[./]/g, "").replace(/^\.\.$/, "");
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

  // Parse each page's own front matter (prereq/time/outcome).
  for (const page of pages) {
    const raw = readFileSync(page.file, "utf8");
    const parsed = matter(raw);
    page.data = parsed.data ?? {};
    page.body = parsed.content;
  }

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });

  for (const page of pages) {
    const body = rewriteLinks(page.body, page.sectionSlug, pages)
      .replace(/^#\s+.+?\n+/m, ""); // strip raw H1 -- layout renders title from frontmatter

    const fm = [
      "---",
      `title: ${yamlValue(page.title)}`,
      `section: ${yamlValue(page.sectionLabel)}`,
      `sectionSlug: ${yamlValue(page.sectionSlug)}`,
      `sectionOrder: ${page.sectionOrder}`,
      `order: ${page.order}`,
      `permalink: ${page.permalink}`,
      `layout: doc.njk`,
      `tags: nixops-docs`,
    ];
    if (page.data.time) fm.push(`time: ${yamlValue(page.data.time)}`);
    fm.push("---", "");

    // Preserve source tree under DEST so nothing collides.
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
