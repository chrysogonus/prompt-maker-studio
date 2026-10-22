/**
 * Free, curated prompt templates for the public gallery. Hand-written and
 * reviewed; "featured" order is editorial, since nothing about visitors is
 * tracked. Every template uses the app's sections and {{variables}}, so it can
 * be filled in on the page or saved to a library unchanged.
 */

import { GUIDES, guideMetadata } from './guides';
import type { PromptField } from '@/types/prompt';

export type GalleryCategoryId = 'coding' | 'image' | 'research' | 'everyday';

export interface GalleryCategory {
  id: GalleryCategoryId;
  label: string;
  description: string;
}

export interface GalleryTemplate {
  slug: string;
  title: string;
  category: GalleryCategoryId;
  summary: string;
  /** Lower comes first among featured templates; unset templates are not featured. */
  featured?: number;
  sections: PromptField[];
  hints: Record<string, string>;
  examples: Record<string, string>;
  tips: string[];
  guide?: keyof typeof GUIDES;
}

export const GALLERY_CATEGORIES: GalleryCategory[] = [
  { id: 'coding', label: 'Coding agents', description: 'Task briefs for Claude Code, Codex, Cursor and other agents that edit your repository.' },
  { id: 'image', label: 'Image generation', description: 'Structured prompts for DALL·E, Midjourney, Stable Diffusion and Gemini.' },
  { id: 'research', label: 'Research & writing', description: 'Summaries, reports and drafts that stay close to your sources.' },
  { id: 'everyday', label: 'Everyday work', description: 'Email, meetings, planning and learning.' },
];

export const GALLERY: GalleryTemplate[] = [
  // Coding agents
  {
    slug: 'bug-fix-brief',
    title: 'Bug fix brief for a coding agent',
    category: 'coding',
    summary: 'Find the root cause of a bug, fix it minimally and prove it with a regression test.',
    featured: 1,
    sections: [
      { name: 'Goal', content: 'Fix this bug: {{symptom}}. Expected behaviour: {{expected}}.' },
      { name: 'Context', content: 'Start in {{files}}. Read the project instructions file before changing anything.' },
      { name: 'Constraints', content: 'Find the root cause before editing. Keep the change minimal and match the surrounding code. Do not change public APIs, dependencies or unrelated files. Do not commit or push.' },
      { name: 'Done when', content: 'A new regression test fails before the fix and passes after it, and {{check_command}} passes.' },
      { name: 'Report', content: 'Explain the cause, the change, the commands you ran with their results, and anything you could not verify.' },
    ],
    hints: { symptom: 'What goes wrong, and how to reproduce it', expected: 'What should happen instead', files: 'Files or modules to start in', check_command: 'Test or lint command' },
    examples: { symptom: 'saving a prompt with an emoji in its name returns a 500 error', expected: 'the prompt saves and keeps the emoji', files: 'backend/app/services/prompts/', check_command: 'make test' },
    tips: ['Describe the symptom, not your guess at the fix.', 'Ask for one bug per prompt so each change stays reviewable.'],
    guide: 'codingAgents',
  },
  {
    slug: 'feature-implementation-plan',
    title: 'Plan a feature before coding',
    category: 'coding',
    summary: 'Get an implementation plan with files, steps and tests to review before the agent writes code.',
    featured: 5,
    sections: [
      { name: 'Goal', content: 'Plan how to add this feature: {{feature}}.' },
      { name: 'Context', content: 'Users need it because {{reason}}. Related code: {{related_code}}.' },
      { name: 'Task', content: 'Read the relevant code first. Do not edit any files yet.' },
      { name: 'Format', content: 'A short plan: the approach in two sentences, the files to change and why, the steps in order, the tests to add, and open questions for me.' },
      { name: 'Constraints', content: 'Prefer existing helpers and patterns over new abstractions. Point out anything that needs a schema or API change.' },
    ],
    hints: { feature: 'What should be possible afterwards', reason: 'Why it is needed', related_code: 'Files, modules or similar features' },
    examples: { feature: 'export a folder of prompts as Markdown', reason: 'people want to keep prompts in their notes app', related_code: 'the existing JSON export' },
    tips: ['Review the plan, then ask the agent to implement one step at a time.'],
    guide: 'codingAgents',
  },
  {
    slug: 'code-review-checklist',
    title: 'Review a change before merging',
    category: 'coding',
    summary: 'A focused review of a diff for bugs, security and missing tests, ranked by severity.',
    sections: [
      { name: 'Role', content: 'You are a senior reviewer who cares about correctness first, then clarity.' },
      { name: 'Task', content: 'Review this change: {{change}}. Its purpose: {{purpose}}.' },
      { name: 'Focus', content: 'Look for bugs and edge cases, security problems, missing or weak tests, and code that contradicts the surrounding conventions.' },
      { name: 'Format', content: 'A list of findings, most severe first. For each: file and line, the problem, a concrete failure scenario and a suggested fix. End with "No blocking issues" if there are none.' },
      { name: 'Constraints', content: 'Do not comment on formatting a linter handles. Do not invent problems to fill the list.' },
    ],
    hints: { change: 'Branch, pull request or pasted diff', purpose: 'What the change is meant to do' },
    examples: { change: 'the diff of the current branch against dev', purpose: 'let users test an AI connection before saving it' },
    tips: ['A failure scenario per finding separates real bugs from style opinions.'],
    guide: 'codingAgents',
  },
  {
    slug: 'write-tests-for-module',
    title: 'Write tests for existing code',
    category: 'coding',
    summary: 'Add tests that pin down current behaviour, following the project’s test conventions.',
    sections: [
      { name: 'Goal', content: 'Add tests for {{target}}.' },
      { name: 'Context', content: 'Follow the conventions of the existing tests in {{test_location}}.' },
      { name: 'Task', content: 'Cover the main behaviour, edge cases ({{edge_cases}}) and error handling. Test behaviour through public functions, not private details.' },
      { name: 'Constraints', content: 'Do not change the code under test. If you find a bug, write a failing test for it, mark it as expected to fail, and report it.' },
      { name: 'Done when', content: '{{test_command}} passes and each new test fails if the behaviour it describes breaks.' },
    ],
    hints: { target: 'Module or function', test_location: 'Where similar tests live', edge_cases: 'Empty input, limits, unusual values', test_command: 'Command that runs the tests' },
    examples: { target: 'the CSV import of test cases', test_location: 'backend/tests/', edge_cases: 'empty file, a quoted comma, 21 rows', test_command: 'make test' },
    tips: ['Ask the agent to break the code briefly and confirm the new test fails.'],
  },
  {
    slug: 'refactor-without-behaviour-change',
    title: 'Refactor without changing behaviour',
    category: 'coding',
    summary: 'Simplify code in small, safe steps while keeping the tests green.',
    sections: [
      { name: 'Goal', content: 'Make {{target}} easier to read and change, without changing what it does.' },
      { name: 'Problems', content: 'What bothers me: {{problems}}.' },
      { name: 'Constraints', content: 'Behaviour, outputs, error messages and side effects stay the same. Work in small steps and run {{test_command}} after each. No new dependencies.' },
      { name: 'Report', content: 'List each step and why it helps. Flag anything you were unsure was behaviour-preserving instead of changing it.' },
    ],
    hints: { target: 'File, class or function', problems: 'Duplication, long functions, unclear names', test_command: 'Command that runs the tests' },
    examples: { target: 'the settings form component', problems: 'save and test build the same request twice', test_command: 'npm test' },
    tips: ['Make sure the area is covered by tests before refactoring; ask for those first if not.'],
  },
  {
    slug: 'explain-unfamiliar-codebase',
    title: 'Explain an unfamiliar codebase',
    category: 'coding',
    summary: 'A guided tour of a repository: structure, main flows and where to make a given change.',
    sections: [
      { name: 'Role', content: 'You are a patient senior engineer onboarding a new colleague.' },
      { name: 'Task', content: 'Explain how this repository is organized and how {{flow}} works end to end. I want to {{my_goal}}.' },
      { name: 'Format', content: 'Start with a one-paragraph overview, then the main directories, then the flow step by step with file paths, then where I would make my change.' },
      { name: 'Constraints', content: 'Read the code; do not guess. Do not edit any files. Say when something is unclear.' },
    ],
    hints: { flow: 'A user action or request to trace', my_goal: 'What you want to change or understand' },
    examples: { flow: 'saving a prompt from the editor', my_goal: 'add a word count to each saved version' },
    tips: [],
  },
  // Image generation
  {
    slug: 'product-photo',
    title: 'Product photo',
    category: 'image',
    summary: 'A clean studio-style product shot with controlled light, background and framing.',
    featured: 3,
    sections: [
      { name: 'Subject', content: 'A product photo of {{product}}, {{detail}}.' },
      { name: 'Setting', content: 'On {{surface}}, against a {{background}} background, with plenty of empty space on the {{space_side}}.' },
      { name: 'Style', content: 'Studio photography, soft diffused light from the left, gentle shadow, sharp focus on the product, 85 mm lens look.' },
      { name: 'Format', content: '{{aspect}} aspect ratio.' },
      { name: 'Avoid', content: 'Text, logos, watermarks, hands, clutter, reflections that hide the product.' },
    ],
    hints: { product: 'What is being photographed', detail: 'Material, colour, what to show', surface: 'What it stands on', background: 'Background colour or scene', space_side: 'Where text will go later', aspect: 'For example 1:1, 4:5, 16:9' },
    examples: { product: 'a matte black ceramic coffee mug', detail: 'handle turned to the right, a little steam', surface: 'a light oak table', background: 'warm beige', space_side: 'right', aspect: '4:5' },
    tips: ['Leave empty space if you will add a headline later.', 'Change one detail at a time between generations.'],
    guide: 'imagePrompts',
  },
  {
    slug: 'illustration-scene',
    title: 'Illustrated scene',
    category: 'image',
    summary: 'A storybook-style illustration with subject, mood, palette and composition spelled out.',
    sections: [
      { name: 'Subject', content: 'An illustration of {{subject}} {{action}} in {{setting}}.' },
      { name: 'Mood', content: 'The mood is {{mood}}, at {{time_of_day}}.' },
      { name: 'Style', content: '{{style}}, {{palette}} palette, visible texture, clean shapes.' },
      { name: 'Composition', content: 'Wide shot, subject slightly left of centre, foreground details framing the scene.' },
      { name: 'Avoid', content: 'Text, signatures, distorted faces or hands.' },
    ],
    hints: { subject: 'Who or what', action: 'What they are doing', setting: 'Where', mood: 'Calm, playful, mysterious', time_of_day: 'Dawn, noon, night', style: 'Watercolour, gouache, flat vector', palette: 'Colours' },
    examples: { subject: 'a small fox', action: 'reading a map', setting: 'a snowy forest clearing', mood: 'calm and curious', time_of_day: 'dusk', style: 'Gouache storybook illustration', palette: 'deep blue and warm orange' },
    tips: ['Describe qualities of a style instead of naming living artists.'],
    guide: 'imagePrompts',
  },
  {
    slug: 'portrait-photo',
    title: 'Portrait photo',
    category: 'image',
    summary: 'A natural portrait with lighting, lens and expression described like a photographer would.',
    sections: [
      { name: 'Subject', content: 'A portrait of {{person}}, {{expression}}, wearing {{clothing}}.' },
      { name: 'Setting', content: '{{setting}}, softly out of focus behind them.' },
      { name: 'Camera', content: 'Head and shoulders, eye level, 85 mm lens, shallow depth of field.' },
      { name: 'Lighting', content: '{{lighting}}, natural skin texture.' },
      { name: 'Avoid', content: 'Heavy retouching, text, extra fingers, distorted features.' },
    ],
    hints: { person: 'Age, appearance (fictional)', expression: 'Laughing, thoughtful', clothing: 'What they wear', setting: 'Background', lighting: 'Window light, golden hour' },
    examples: { person: 'a woman in her sixties with short grey hair', expression: 'smiling thoughtfully', clothing: 'a green wool sweater', setting: 'a bookshop', lighting: 'Soft window light from the side' },
    tips: ['Describe fictional people; do not generate images of real people without consent.'],
    guide: 'imagePrompts',
  },
  {
    slug: 'social-media-graphic',
    title: 'Social media background',
    category: 'image',
    summary: 'An on-brand background image with room for your own headline.',
    sections: [
      { name: 'Subject', content: 'A background image about {{theme}}, with an abstract hint of {{motif}}.' },
      { name: 'Style', content: '{{style}}, brand colours {{brand_colours}}, calm and uncluttered.' },
      { name: 'Composition', content: 'Keep the {{text_area}} third empty and evenly lit for a headline added later.' },
      { name: 'Format', content: '{{aspect}} aspect ratio.' },
      { name: 'Avoid', content: 'Any text, letters or numbers, logos, faces.' },
    ],
    hints: { theme: 'Topic of the post', motif: 'A visual element', style: 'Flat, photographic, 3D', brand_colours: 'Colour names or hex values', text_area: 'Top, left, centre', aspect: '1:1 for posts, 9:16 for stories' },
    examples: { theme: 'a product launch', motif: 'rising paper planes', style: 'Soft 3D render', brand_colours: 'coral and deep plum', text_area: 'top', aspect: '1:1' },
    tips: ['Image models are unreliable with text; add the headline in a design tool.'],
    guide: 'imagePrompts',
  },
  {
    slug: 'icon-set',
    title: 'Consistent icon set',
    category: 'image',
    summary: 'Simple icons that share one style, generated one subject at a time.',
    sections: [
      { name: 'Subject', content: 'A single icon of {{subject}}.' },
      { name: 'Style', content: 'Flat {{line_style}} icon, {{stroke}} strokes, rounded corners, {{colour}} on a plain white background, centred with even padding.' },
      { name: 'Consistency', content: 'Same style as the rest of the set: {{set_description}}.' },
      { name: 'Avoid', content: 'Gradients, shadows, text, extra objects, perspective.' },
    ],
    hints: { subject: 'What the icon shows', line_style: 'Outline or filled', stroke: 'Thin, medium, bold', colour: 'One colour', set_description: 'What the other icons look like' },
    examples: { subject: 'a folder with a star', line_style: 'outline', stroke: 'medium', colour: 'dark plum', set_description: 'simple office objects, one colour, no fills' },
    tips: ['Keep everything except the subject identical across the set.'],
    guide: 'imagePrompts',
  },
  {
    slug: 'interior-concept',
    title: 'Interior design concept',
    category: 'image',
    summary: 'A room visualised with style, materials, light and camera position.',
    sections: [
      { name: 'Subject', content: 'A {{room}} in {{style}} style, for {{who}}.' },
      { name: 'Materials', content: '{{materials}}, a palette of {{palette}}.' },
      { name: 'Lighting', content: '{{lighting}}.' },
      { name: 'Camera', content: 'Wide-angle view from the doorway at eye height, straight vertical lines.' },
      { name: 'Avoid', content: 'Text, people, clutter, warped furniture.' },
    ],
    hints: { room: 'Kitchen, study, bedroom', style: 'Scandinavian, mid-century, industrial', who: 'Who uses the room', materials: 'Wood, stone, fabrics', palette: 'Colours', lighting: 'Daylight, evening lamps' },
    examples: { room: 'small home office', style: 'Japandi', who: 'someone working from home', materials: 'light ash wood, linen, a wool rug', palette: 'sand, olive and off-white', lighting: 'Late-afternoon daylight from a large window' },
    tips: [],
    guide: 'imagePrompts',
  },
  // Research & writing
  {
    slug: 'summarize-with-sources',
    title: 'Summarize sources with citations',
    category: 'research',
    summary: 'A cited summary that uses only the sources you paste and admits what they do not cover.',
    featured: 2,
    sections: [
      { name: 'Role', content: 'You are a careful research assistant writing for {{audience}}.' },
      { name: 'Sources', content: 'Use only these numbered sources:\n{{sources}}' },
      { name: 'Task', content: 'Answer: {{question}}. Cite every claim with the source number in brackets, such as [2].' },
      { name: 'Format', content: 'A two-sentence answer, then up to four short sections with headings. At most {{word_limit}} words.' },
      { name: 'Constraints', content: 'Separate what the sources agree on from where they disagree. If they do not answer part of the question, say so. Never invent sources, numbers or quotes.' },
    ],
    hints: { audience: 'Who will read it', sources: 'Paste each source after a number: [1] …', question: 'What you want to know', word_limit: 'For example 300' },
    examples: { audience: 'a product manager new to the topic', question: 'what limits battery life in cold weather?', word_limit: '300' },
    tips: ['Check the cited passages for anything you will repeat or publish.'],
    guide: 'researchWriting',
  },
  {
    slug: 'blog-post-draft',
    title: 'Blog post draft from key points',
    category: 'research',
    summary: 'A readable first draft that keeps your facts and voice, and flags what needs detail.',
    featured: 6,
    sections: [
      { name: 'Role', content: 'You write for {{audience}} in a plain, friendly voice, like this: "{{voice_sample}}"' },
      { name: 'Key points', content: '{{key_points}}' },
      { name: 'Task', content: 'Write a blog post titled "{{title}}" using only the key points.' },
      { name: 'Format', content: 'An opening paragraph that states the point, three to five short sections with headings, and a closing sentence with one clear next step. About {{word_count}} words.' },
      { name: 'Constraints', content: 'No superlatives you cannot prove, no invented quotes or numbers. If a key point is vague, write around it and list it under "Needs detail" after the post.' },
    ],
    hints: { audience: 'Readers', voice_sample: 'One or two sentences in your voice', key_points: 'Bullet list of facts and claims', title: 'Working title', word_count: 'For example 800' },
    examples: { audience: 'small-business owners', voice_sample: 'We keep things simple: you get one invoice a month, and that is it.', title: 'Why we switched to monthly billing', word_count: '700' },
    tips: [],
    guide: 'researchWriting',
  },
  {
    slug: 'compare-options',
    title: 'Compare options for a decision',
    category: 'research',
    summary: 'A neutral comparison table with trade-offs and a recommendation tied to your criteria.',
    sections: [
      { name: 'Context', content: 'I need to decide {{decision}}. What matters most: {{criteria}}.' },
      { name: 'Options', content: '{{options}}' },
      { name: 'Task', content: 'Compare the options against each criterion, using the information I give and well-established general knowledge only.' },
      { name: 'Format', content: 'A table with one row per option and one column per criterion, then the main trade-off in two sentences, then a recommendation and what would change it.' },
      { name: 'Constraints', content: 'Mark anything you are unsure about or that may be out of date. Do not invent prices or statistics.' },
    ],
    hints: { decision: 'What you are choosing', criteria: 'Ranked list of what matters', options: 'Options with any facts you have' },
    examples: { decision: 'which database to use for a small internal tool', criteria: '1. simple to run, 2. backups, 3. cost', options: 'SQLite, PostgreSQL, a hosted spreadsheet' },
    tips: ['Ranking your criteria makes the recommendation less generic.'],
    guide: 'researchWriting',
  },
  {
    slug: 'rewrite-for-audience',
    title: 'Rewrite for a different audience',
    category: 'research',
    summary: 'Adapt a text for new readers without losing its facts.',
    sections: [
      { name: 'Text', content: '{{text}}' },
      { name: 'Task', content: 'Rewrite the text for {{audience}}, who need to {{reader_goal}}.' },
      { name: 'Constraints', content: 'Keep every fact, number and name. Explain terms they would not know the first time they appear. Reading level: {{reading_level}}. Length: about {{length}}.' },
      { name: 'Format', content: 'The rewritten text, then a short list of anything you removed or simplified.' },
    ],
    hints: { text: 'Paste the original', audience: 'New readers', reader_goal: 'What they will do with it', reading_level: 'For example general public', length: 'Same, shorter, one paragraph' },
    examples: { audience: 'customers with no technical background', reader_goal: 'understand what changes for them', reading_level: 'general public', length: 'half the original' },
    tips: [],
    guide: 'researchWriting',
  },
  {
    slug: 'literature-notes',
    title: 'Structured notes from a paper',
    category: 'research',
    summary: 'Reading notes that separate claims, evidence and limitations, with page references.',
    sections: [
      { name: 'Paper', content: '{{paper_text}}' },
      { name: 'Task', content: 'Take reading notes for {{purpose}}.' },
      { name: 'Format', content: 'Headings: Question, Method, Main findings (with page or section references), Limitations the authors state, Limitations you notice, Open questions, Useful quotes (verbatim, with references).' },
      { name: 'Constraints', content: 'Quote only text that appears in the paper. Keep the authors’ claims separate from your assessment.' },
    ],
    hints: { paper_text: 'Paste the paper or the sections you need', purpose: 'Why you are reading it' },
    examples: { purpose: 'a literature review on remote-work productivity' },
    tips: ['Long papers may exceed the model’s context; paste the sections you need.'],
    guide: 'researchWriting',
  },
  {
    slug: 'fact-check-draft',
    title: 'Fact-check a draft',
    category: 'research',
    summary: 'List every checkable claim in a draft and how to verify it.',
    sections: [
      { name: 'Draft', content: '{{draft}}' },
      { name: 'Task', content: 'List every factual claim that could be wrong: numbers, dates, names, quotes and statements about the world.' },
      { name: 'Format', content: 'A table: the claim as written, why it might be wrong, how to check it, and a risk level (high, medium, low). High-risk claims first.' },
      { name: 'Constraints', content: 'Do not say whether claims are true unless the draft itself provides the evidence; your job is to find what needs checking.' },
    ],
    hints: { draft: 'Paste the text to check' },
    examples: {},
    tips: ['Use it before publishing anything an AI helped write.'],
    guide: 'researchWriting',
  },
  // Everyday work
  {
    slug: 'meeting-summary',
    title: 'Meeting summary with action items',
    category: 'everyday',
    summary: 'Decisions, open questions and owned action items from a transcript or notes.',
    featured: 4,
    sections: [
      { name: 'Notes', content: '{{transcript}}' },
      { name: 'Task', content: 'Summarize this meeting for someone who missed it.' },
      { name: 'Format', content: 'Three headings: Decisions, Open questions, Action items. Action items as "Owner — task — due date"; write "no owner" or "no date" when the notes do not say.' },
      { name: 'Constraints', content: 'Separate what was decided from what was only discussed. Do not attribute opinions to people unless the notes name them. At most {{word_limit}} words.' },
    ],
    hints: { transcript: 'Paste the transcript or notes', word_limit: 'For example 250' },
    examples: { word_limit: '250' },
    tips: [],
    guide: 'goodPrompt',
  },
  {
    slug: 'tricky-email-reply',
    title: 'Reply to a tricky email',
    category: 'everyday',
    summary: 'A warm but firm reply that addresses the point and proposes a next step.',
    sections: [
      { name: 'Email', content: '{{email}}' },
      { name: 'Context', content: 'My relationship to the sender: {{relationship}}. What I want to achieve: {{goal}}.' },
      { name: 'Task', content: 'Draft a reply.' },
      { name: 'Constraints', content: 'Warm but firm. Acknowledge their point in one sentence, state my position plainly, propose one concrete next step. Under {{word_limit}} words. No grovelling, no passive aggression.' },
    ],
    hints: { email: 'Paste the email', relationship: 'Client, colleague, manager', goal: 'The outcome you want', word_limit: 'For example 150' },
    examples: { relationship: 'a long-standing client', goal: 'keep the deadline without extra cost', word_limit: '150' },
    tips: ['Ask for two versions with different tones and pick one.'],
    guide: 'goodPrompt',
  },
  {
    slug: 'weekly-status-update',
    title: 'Weekly status update',
    category: 'everyday',
    summary: 'A short update for stakeholders: shipped, at risk, and what you need from others.',
    sections: [
      { name: 'Role', content: 'You are a concise engineering lead writing for busy stakeholders who skim.' },
      { name: 'Context', content: 'Team: {{team}}. Week: {{week}}.\nRaw notes:\n{{notes}}' },
      { name: 'Task', content: 'Turn the notes into a status update. Lead with what shipped, then what is at risk and why, then what we need from others.' },
      { name: 'Format', content: 'Three sections with plain headings: Shipped, At risk, Asks. At most five bullets per section. No intro or sign-off.' },
    ],
    hints: { team: 'Team or project', week: 'Dates', notes: 'Stand-up notes, ticket titles, chat snippets' },
    examples: { team: 'Payments', week: '6–10 Oct' },
    tips: [],
    guide: 'reusable',
  },
  {
    slug: 'explain-like-a-tutor',
    title: 'Explain a topic like a patient tutor',
    category: 'everyday',
    summary: 'A step-by-step explanation at the right level, with an example and a check question.',
    sections: [
      { name: 'Role', content: 'You are a patient tutor who explains with everyday examples, not jargon.' },
      { name: 'Task', content: 'Explain {{topic}} to someone who {{background}}.' },
      { name: 'Format', content: 'Three short steps, each with one everyday example, then one question that checks understanding. Wait for my answer before going further.' },
      { name: 'Constraints', content: 'Define any technical term the first time you use it. Keep it under 250 words.' },
    ],
    hints: { topic: 'What to learn', background: 'What the learner already knows' },
    examples: { topic: 'compound interest', background: 'is good with everyday budgeting but has never invested' },
    tips: [],
    guide: 'goodPrompt',
  },
  {
    slug: 'meal-plan',
    title: 'Weekly meal plan',
    category: 'everyday',
    summary: 'Dinners that reuse ingredients, fit your time and diet, with a shopping list.',
    sections: [
      { name: 'Task', content: 'Plan {{days}} dinners for {{people}} people.' },
      { name: 'Constraints', content: 'Diet: {{diet}}. Most meals under {{minutes}} minutes. Reuse ingredients across meals so little goes to waste. Avoid: {{avoid}}.' },
      { name: 'Format', content: 'A table with day, dish and cooking time, then one shopping list grouped by aisle, with quantities.' },
    ],
    hints: { days: 'Number of dinners', people: 'How many', diet: 'Vegetarian, no restrictions', minutes: 'For example 30', avoid: 'Allergies, dislikes' },
    examples: { days: '5', people: '2', diet: 'vegetarian', minutes: '30', avoid: 'mushrooms' },
    tips: [],
  },
  {
    slug: 'job-description-to-cv-match',
    title: 'Match a CV to a job description',
    category: 'everyday',
    summary: 'See which requirements your CV covers, which it misses, and how to phrase the gaps.',
    sections: [
      { name: 'Job description', content: '{{job_description}}' },
      { name: 'CV', content: '{{cv}}' },
      { name: 'Task', content: 'Compare the CV with the job description.' },
      { name: 'Format', content: 'A table of the main requirements with "covered", "partly" or "missing" and the CV evidence; then three bullet points I could add to the CV, using only experience the CV already shows.' },
      { name: 'Constraints', content: 'Do not invent experience, titles or numbers.' },
    ],
    hints: { job_description: 'Paste the job ad', cv: 'Paste your CV' },
    examples: {},
    tips: ['Remove personal contact details before pasting a CV into any AI tool.'],
  },
];

export const GALLERY_INDEX = {
  path: '/gallery',
  title: 'Free prompt templates',
  description: 'Free, ready-to-use AI prompt templates for coding agents, image generation, research and writing, and everyday work. Fill them in, copy them, or save them to your library.',
};

export function galleryPath(slug: string): string {
  return `${GALLERY_INDEX.path}/${slug}`;
}

export function galleryTemplate(slug: string): GalleryTemplate | undefined {
  return GALLERY.find((template) => template.slug === slug);
}

export function featuredTemplates(): GalleryTemplate[] {
  return GALLERY.filter((template) => template.featured !== undefined)
    .sort((a, b) => (a.featured ?? 0) - (b.featured ?? 0));
}

export function galleryMetadata(template?: GalleryTemplate) {
  return guideMetadata(template
    ? { path: galleryPath(template.slug), title: `${template.title}: free prompt template`, description: template.summary }
    : GALLERY_INDEX);
}

/** Templates that point to this guide, so guides can suggest a place to start. */
export function templatesForGuide(path: string): GalleryTemplate[] {
  return GALLERY.filter((template) => template.guide && GUIDES[template.guide].path === path);
}
