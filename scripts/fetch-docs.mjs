#!/usr/bin/env node
/**
 * Sync each project's docs/ into src/docs/<slug>/.
 *
 * Projects are declared in src/_data/site.js (`projects[]`). For every project
 * that has a `repo`, its `docs/_meta.json` drives the sidebar (section slug ->
 * {title, pages}; key order = sidebar order, `pages` order = order within a
 * section). Each page's title lives in its own YAML front matter (`title:`),
 * so the label is edited next to the content it describes.
 *
 * Per-project source resolution (first hit wins):
 *   1. <SLUG>_DOCS env var (absolute path to a checked-out docs/ dir)
 *   2. ../<slug>/docs (local sibling checkout, dev convenience)
 *   3. shallow git clone of the project's repo (CI / Cloudflare)
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import site from "../src/_data/site.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function envKey(slug) {
  return `${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_DOCS`;
}

function resolveSource(project) {
  const key = envKey(project.slug);
  if (process.env[key]) {
    const p = resolve(process.env[key]);
    if (!existsSync(p)) throw new Error(`${key}=${p} does not exist`);
    return { path: p, cleanup: null, origin: key };
  }
  const sibling = resolve(ROOT, "..", project.slug, "docs");
  if (existsSync(sibling)) {
    return { path: sibling, cleanup: null, origin: `sibling ../${project.slug}/docs` };
  }
  const repo = `${project.repo}.git`;
  const tmp = mkdtempSync(join(tmpdir(), `${project.slug}-docs-`));
  console.log(`[fetch-docs] cloning ${repo} into ${tmp}`);
  execSync(`git clone --depth 1 --filter=blob:none ${repo} ${tmp}`, { stdio: "inherit" });
  const docsPath = join(tmp, "docs");
  if (!existsSync(docsPath)) {
    throw new Error(
      `[fetch-docs] cloned ${repo} but docs/ is missing -- ` +
        `did you commit and push ${project.slug}/docs?`
    );
  }
  return {
    path: docsPath,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
    origin: `git clone ${repo}`,
  };
}

function loadManifest(srcRoot) {
  const p = join(srcRoot, "_meta.json");
  if (!existsSync(p)) throw new Error(`[fetch-docs] missing _meta.json in ${srcRoot}`);
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`[fetch-docs] _meta.json must be an object of {sectionSlug: {title, pages}}`);
  }
  // JSON key order is preserved by V8, so section order == file order.
  return Object.entries(parsed).map(([slug, value]) => {
    if (!value || typeof value !== "object" || !value.title || !Array.isArray(value.pages)) {
      throw new Error(`[fetch-docs] section "${slug}" needs {title, pages}: ${JSON.stringify(value)}`);
    }
    return { slug, title: value.title, pages: value.pages };
  });
}

function buildPages(srcRoot, urlBase) {
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
        throw new Error(`[fetch-docs] ${section.slug}/${pageSlug}.md has no title: in front matter`);
      }
      const isSectionIndex = pageSlug === "index" && section.slug === "overview";
      const permalink = isSectionIndex
        ? `${urlBase}/`
        : `${urlBase}/${section.slug}/${pageSlug}/`;
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
      const target = allPages.find((p) => p.slug === slug && p.sectionSlug === targetSection);
      if (!target) return whole;
      return `](${target.permalink}${anchor ?? ""})`;
    }
  );
}

function yamlValue(v) {
  return JSON.stringify(v);
}

function syncProject(project) {
  const urlBase = `/docs/${project.slug}`;
  const dest = join(ROOT, "src", "docs", project.slug);
  const src = resolveSource(project);
  console.log(`[fetch-docs] ${project.slug}: source ${src.origin} (${src.path})`);

  const { sections, pages } = buildPages(src.path, urlBase);

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  for (const page of pages) {
    const body = rewriteLinks(page.body, page.sectionSlug, pages)
      .replace(/^#\s+.+?\n+/m, ""); // strip raw H1 -- layout renders `title` on its own

    const fm = [
      "---",
      `title: ${yamlValue(page.title)}`,
      `project: ${yamlValue(project.slug)}`,
      `section: ${yamlValue(page.sectionTitle)}`,
      `sectionSlug: ${yamlValue(page.sectionSlug)}`,
      `sectionOrder: ${page.sectionOrder}`,
      `order: ${page.order}`,
      `permalink: ${page.permalink}`,
      `layout: doc.njk`,
      `tags: ${project.slug}-docs`,
    ];
    if (page.time) fm.push(`time: ${yamlValue(page.time)}`);
    fm.push("---", "");

    const destPath = page.isSectionIndex
      ? join(dest, "index.md")
      : join(dest, page.sectionSlug, `${page.slug}.md`);
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, fm.join("\n") + body);
  }

  if (src.cleanup) src.cleanup();
  console.log(
    `[fetch-docs] ${project.slug}: wrote ${pages.length} pages across ${sections.length} sections to ${dest}`
  );
}

function main() {
  const projects = (site.projects ?? []).filter((p) => p.repo);
  if (projects.length === 0) {
    console.log("[fetch-docs] no projects with a repo in site.projects -- nothing to do");
    return;
  }
  for (const project of projects) syncProject(project);
}

main();
