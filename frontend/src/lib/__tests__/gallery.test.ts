import { describe, expect, it } from 'vitest';
import { GALLERY, GALLERY_CATEGORIES, featuredTemplates, galleryTemplate, relatedTemplates, templatesForGuide } from '../gallery';
import { GUIDES } from '../guides';
import { lintPrompt } from '../promptLint';
import { renderSections, sectionNameError, unbalancedTags, variablesIn } from '../sections';

describe('gallery data', () => {
  it('has unique slugs and every category in use', () => {
    expect(new Set(GALLERY.map((template) => template.slug)).size).toBe(GALLERY.length);
    for (const category of GALLERY_CATEGORIES) {
      expect(GALLERY.filter((template) => template.category === category.id).length).toBeGreaterThanOrEqual(5);
    }
  });

  it.each(GALLERY.map((template) => [template.slug, template] as const))('%s is a valid, saveable template', (_, template) => {
    const names = template.sections.map((section) => section.name);
    for (const [i, name] of names.entries()) expect(sectionNameError(name, names.filter((_, j) => j !== i))).toBeNull();
    for (const section of template.sections) {
      expect(section.content.length).toBeLessThanOrEqual(10_000);
      expect(unbalancedTags(section.content)).toEqual([]);
    }
    const variables = variablesIn(template.sections);
    expect(variables.length).toBeGreaterThan(0);
    for (const key of [...Object.keys(template.hints), ...Object.keys(template.examples)]) expect(variables).toContain(key);
    // Use example inputs then fills every field, so the demo prompt is complete.
    expect(variables.filter((name) => !template.examples[name]?.trim())).toEqual([]);
    expect(lintPrompt(renderSections(template.sections)).filter((finding) => finding.severity === 'problem')).toEqual([]);
    if (template.guide) expect(GUIDES[template.guide]).toBeDefined();
  });

  it('orders featured templates and finds templates by slug and guide', () => {
    expect(featuredTemplates().map((template) => template.featured)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(galleryTemplate('bug-fix-brief')?.title).toBe('Bug fix brief for a coding agent');
    expect(galleryTemplate('missing')).toBeUndefined();
    expect(templatesForGuide(GUIDES.codingAgents.path).every((template) => template.guide === 'codingAgents')).toBe(true);
    expect(templatesForGuide('/guides/unknown')).toEqual([]);
  });

  it('links every template from the related list of its neighbours', () => {
    const inbound = new Map<string, number>();
    for (const template of GALLERY) {
      const related = relatedTemplates(template);
      expect(related.length, template.slug).toBe(Math.min(4, GALLERY.filter((item) => item.category === template.category).length - 1));
      expect(related.every((item) => item.category === template.category && item !== template), template.slug).toBe(true);
      for (const item of related) inbound.set(item.slug, (inbound.get(item.slug) ?? 0) + 1);
    }
    for (const template of GALLERY) expect(inbound.get(template.slug) ?? 0, template.slug).toBeGreaterThanOrEqual(2);
  });
});
