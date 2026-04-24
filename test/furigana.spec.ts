import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readFileSync } from 'node:fs';
import { ACTIVE_CONVERT_CASES, BACKLOG_CONVERT_CASES } from './furigana-cases';

vi.mock('wxt/browser', () => ({ browser: fakeBrowser }));

type PatchVersionPayload = {
  version: string;
  min_app_version?: string;
  last_updated?: string;
  message?: string;
};

type SpecialCasesPayload = {
  version: string;
  compounds?: Record<string, string[]>;
  patch_chars?: Record<string, unknown>;
};

const LOCAL_DICT = readJsonFixture('../public/json/kanji-jouyou.json');
const LOCAL_FIXED_READINGS = readJsonFixture('../public/json/fixed-readings.json');
const LOCAL_FAMILY_NAMES = readJsonFixture('../public/json/family-names.json');

const CDN_VERSION_URL = 'https://cdn.jsdelivr.net/gh/amehito/japanese-dict-patch@main/version.json';
const CDN_SPECIAL_CASES_URL = 'https://cdn.jsdelivr.net/gh/amehito/japanese-dict-patch@main/special_cases.json';

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function readJsonFixture(relativePath: string) {
  const fileUrl = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(fileUrl, 'utf-8'));
}

function setupFetchMock(options?: {
  localDict?: unknown;
  localFixedReadings?: unknown;
  localFamilyNames?: unknown;
  versionPayload?: PatchVersionPayload;
  specialCasesPayload?: SpecialCasesPayload;
}) {
  const {
    localDict = LOCAL_DICT,
    localFixedReadings = LOCAL_FIXED_READINGS,
    localFamilyNames = LOCAL_FAMILY_NAMES,
    versionPayload = { version: '20260329.01', min_app_version: '1.0.0', last_updated: '2026-03-29' },
    specialCasesPayload = { version: '20260329.01', compounds: {}, patch_chars: {} },
  } = options ?? {};

  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/json/kanji-jouyou.json')) return createJsonResponse(localDict);
    if (url.includes('/json/fixed-readings.json')) return createJsonResponse(localFixedReadings);
    if (url.includes('/json/family-names.json')) return createJsonResponse(localFamilyNames);
    if (url === CDN_VERSION_URL) return createJsonResponse(versionPayload);
    if (url === CDN_SPECIAL_CASES_URL) return createJsonResponse(specialCasesPayload);

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function extractRubyReadings(html: string) {
  return Array.from(html.matchAll(/<rt>(.*?)<\/rt>/g)).map((match) => match[1]);
}

function expectRubyReadingsToMatch(actualReadings: string[], expectedReadings: string[]) {
  if (expectedReadings.length === 1) {
    expect(actualReadings.join('')).toBe(expectedReadings[0]);
    return;
  }

  expect(actualReadings).toEqual(expectedReadings);
}

async function importFreshService() {
  vi.resetModules();
  const module = await import('../util/common');
  return module.furiganaService;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await fakeBrowser.storage.local.clear();
  (fakeBrowser.runtime as typeof fakeBrowser.runtime & {
    getManifest: () => { version: string };
    getURL: (path: string) => string;
  }).getManifest = () => ({ version: '1.0.0' });
  (fakeBrowser.runtime as typeof fakeBrowser.runtime & {
    getURL: (path: string) => string;
  }).getURL = (path: string) => `chrome-extension://test/${path.replace(/^\//, '')}`;
});

describe('furiganaService.convert', () => {
  it.each(ACTIVE_CONVERT_CASES)('$label', async ({ input, expectedReadings, expectedHtml }) => {
    setupFetchMock();
    const service = await importFreshService();

    const html = await service.convert(input, { prev: '', next: '' });

    if (expectedHtml) {
      expect(html).toBe(expectedHtml);
      return;
    }

    expectRubyReadingsToMatch(extractRubyReadings(html), expectedReadings ?? []);
  });

  it('keeps the broader backlog list for future expansion', () => {
    expect(BACKLOG_CONVERT_CASES.length).toBeGreaterThan(0);
  });

  it('prefers remote overrides over local fixed readings when context matches', async () => {
    setupFetchMock();
    await fakeBrowser.storage.local.set({
      remote_overrides: [
        { text: '今日', reading: 'こんにち', prefix: '本' },
      ],
    });
    const service = await importFreshService();

    const html = await service.convert('今日', { prev: '本', next: 'は晴れ' });

    expectRubyReadingsToMatch(extractRubyReadings(html), ['こんにち']);
  });

  it('uses local fixed readings when remote overrides do not match context', async () => {
    setupFetchMock();
    await fakeBrowser.storage.local.set({
      remote_overrides: [
        { text: '今日', reading: 'こんにち', prefix: '本' },
      ],
    });
    const service = await importFreshService();

    const html = await service.convert('今日', { prev: '昨', next: 'は晴れ' });

    expectRubyReadingsToMatch(extractRubyReadings(html), ['きょう']);
  });

  it.each([
    { input: '結果', expected: 'けっか' },
    { input: '設計', expected: 'せっけい' },
  ])('marks heuristic compound sokuon for $input', async ({ input, expected }) => {
    setupFetchMock();
    const service = await importFreshService();

    const html = await service.convert(input, { prev: '', next: '' });

    expectRubyReadingsToMatch(extractRubyReadings(html), [expected]);
    expect(html).toContain('data-reading-tags="possible_sokuon"');
  });

  it('marks compound readings that contain high-risk polyphonic kanji', async () => {
    setupFetchMock();
    const service = await importFreshService();

    const html = await service.convert('中間', { prev: '', next: '' });

    expectRubyReadingsToMatch(extractRubyReadings(html), ['なかあいだ']);
    expect(html).toContain('possible_polyphonic');
  });

  it('does not mark fixed readings as polyphonic-risk fallback readings', async () => {
    setupFetchMock();
    const service = await importFreshService();

    const html = await service.convert('今日', { prev: '', next: '' });

    expectRubyReadingsToMatch(extractRubyReadings(html), ['きょう']);
    expect(html).not.toContain('possible_polyphonic');
  });

  it.each([
    { input: '国際', expected: 'こくさい' },
    { input: '目的', expected: 'もくてき' },
  ])('does not force compound sokuon for $input', async ({ input, expected }) => {
    setupFetchMock();
    const service = await importFreshService();

    const html = await service.convert(input, { prev: '', next: '' });

    expectRubyReadingsToMatch(extractRubyReadings(html), [expected]);
    expect(html).not.toContain('data-reading-tags="possible_sokuon"');
  });
});

describe('furiganaService entity typing', () => {
  it.each([
    { input: '田中', expected: 'person' },
    { input: '新宿', expected: 'place' },
    { input: 'あいう', expected: null },
  ])('classifies $input as $expected', async ({ input, expected }) => {
    setupFetchMock();
    const service = await importFreshService();
    await service.init();

    expect(service.getEntityType(input)).toBe(expected);
  });
});

describe('remote patch refresh', () => {
  it('merges remote compounds and patch chars when versions match', async () => {
    setupFetchMock({
      versionPayload: {
        version: '20260329.02',
        min_app_version: '1.0.0',
        message: 'patched',
      },
      specialCasesPayload: {
        version: '20260329.02',
        compounds: {
          出先: ['でさき'],
        },
        patch_chars: {
          枕: {
            readings_on: ['ちん'],
            readings_kun: ['まくら'],
          },
        },
      },
    });
    const service = await importFreshService();

    await service.init();
    await flushAsyncWork();

    const compoundHtml = await service.convert('出先', { prev: '', next: '' });
    const singleCharHtml = service.baseConvert('枕');
    const storage = await fakeBrowser.storage.local.get(['furigana_patch_version', 'furigana_patch_payload']);

    expectRubyReadingsToMatch(extractRubyReadings(compoundHtml), ['でさき']);
    expectRubyReadingsToMatch(extractRubyReadings(singleCharHtml), ['まくら']);
    expect(storage.furigana_patch_version).toBe('20260329.02');
    expect(storage.furigana_patch_payload).toMatchObject({ version: '20260329.02' });
  });

  it('does not update stored version when version.json and special_cases.json disagree', async () => {
    setupFetchMock({
      versionPayload: {
        version: '20260329.02',
        min_app_version: '1.0.0',
      },
      specialCasesPayload: {
        version: '20260329.03',
        compounds: {
          出先: ['でさき'],
        },
        patch_chars: {},
      },
    });
    const service = await importFreshService();

    await service.init();
    await flushAsyncWork();

    const storage = await fakeBrowser.storage.local.get(['furigana_patch_version', 'furigana_patch_payload']);

    expect(storage.furigana_patch_version).toBeUndefined();
    expect(storage.furigana_patch_payload).toBeUndefined();
  });

  it('stores a gentle notice and skips remote patch download when app version is too low', async () => {
    (fakeBrowser.runtime as typeof fakeBrowser.runtime & {
      getManifest: () => { version: string };
    }).getManifest = () => ({ version: '0.9.0' });

    setupFetchMock({
      versionPayload: {
        version: '20260329.02',
        min_app_version: '1.0.0',
        message: '请升级插件',
      },
    });
    const service = await importFreshService();

    await service.init();
    await flushAsyncWork();

    const storage = await fakeBrowser.storage.local.get(['furigana_patch_notice', 'furigana_patch_version']);

    expect(storage.furigana_patch_version).toBeUndefined();
    expect(storage.furigana_patch_notice).toContain('请升级插件');
  });
});
