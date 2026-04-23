import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';

const SEARCH_API_URL = 'https://proxy.search.docs.aws.com/search';
const RECOMMENDATIONS_API_URL = 'https://contentrecs-api.docs.aws.amazon.com/v1/recommendations';

const BASE_USER_AGENT =
  process.env.MCP_USER_AGENT ??
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const DEFAULT_USER_AGENT = `${BASE_USER_AGENT} PiAWSDocs/0.1.0`;

const PYTHON_BIN = process.env.AWS_DOCS_PYTHON_BIN ?? 'python3';
const PYTHON_HELPER_PATH = fileURLToPath(new URL('./scripts/aws_docs_html.py', import.meta.url));

const SEARCH_TERM_DOMAIN_MODIFIERS = [
  {
    terms: ['neuron', 'neuron sdk'],
    domains: [{ key: 'domain', value: 'awsdocs-neuron.readthedocs-hosted.com' }],
    regex: /^https?:\/\/awsdocs-neuron\.readthedocs-hosted\.com\//,
  },
] as const;

type SearchResult = {
  rank_order: number;
  url: string;
  title: string;
  context?: string;
  sections?: string[];
};

type SearchResponse = {
  search_results: SearchResult[];
  facets?: { product_types?: string[]; guide_types?: string[] };
  query_id: string;
};

type SearchApiMetadata = {
  seo_abstract?: string;
  abstract?: string;
  sections?: unknown;
};

type SearchApiTextExcerptSuggestion = {
  link?: string;
  title?: string;
  summary?: string;
  suggestionBody?: string;
  metadata?: SearchApiMetadata;
};

type SearchApiSuggestion = {
  textExcerptSuggestion?: SearchApiTextExcerptSuggestion;
};

type SearchApiResponse = {
  queryId?: string;
  facets?: Record<string, unknown>;
  suggestions?: SearchApiSuggestion[];
};

type SearchApiRequest = {
  textQuery: { input: string };
  contextAttributes: Array<{ key: string; value: string }>;
  acceptSuggestionBody: 'RawText';
  locales: ['en_us'];
};

type RecommendationApiItem = {
  url?: string;
  assetTitle?: string;
  abstract?: string;
  dateCreated?: string;
};

type RecommendationApiJourneyItem = {
  intent?: string;
  urls?: RecommendationApiItem[];
};

type RecommendationApiResponse = {
  highlyRated?: { items?: RecommendationApiItem[] };
  journey?: { items?: RecommendationApiJourneyItem[] };
  new?: { items?: RecommendationApiItem[] };
  similar?: { items?: RecommendationApiItem[] };
};

type RecommendationResult = {
  url: string;
  title: string;
  context?: string;
};

type HelperRequest =
  | { mode: 'health' }
  | { mode: 'read'; html: string }
  | { mode: 'sections'; html: string; section_titles: string[] };

type HelperResponse = { ok: true; markdown?: string; message?: string } | { ok: false; error: string };

function isHtmlContent(pageRaw: string, contentType: string | null): boolean {
  const ct = (contentType ?? '').toLowerCase();
  return pageRaw.slice(0, 200).toLowerCase().includes('<html') || ct.includes('text/html') || ct === '';
}

function formatDocumentationResult(url: string, content: string, startIndex: number, maxLength: number): string {
  const originalLength = content.length;
  if (startIndex >= originalLength) {
    return `AWS Documentation from ${url}:\n\n<e>No more content available.</e>`;
  }

  const endIndex = Math.min(startIndex + maxLength, originalLength);
  const chunk = content.slice(startIndex, endIndex);
  if (!chunk) {
    return `AWS Documentation from ${url}:\n\n<e>No more content available.</e>`;
  }

  let result = `AWS Documentation from ${url}:\n\n${chunk}`;
  if (endIndex < originalLength) {
    result += `\n\n<e>Content truncated. Call aws_docs_read with start_index=${endIndex} to get more content.</e>`;
  }
  return result;
}

function parseRecommendationResults(data: RecommendationApiResponse): RecommendationResult[] {
  const results: RecommendationResult[] = [];

  for (const item of data.highlyRated?.items ?? []) {
    results.push({ url: item.url ?? '', title: item.assetTitle ?? '', context: item.abstract ?? undefined });
  }
  for (const intentGroup of data.journey?.items ?? []) {
    const intent = intentGroup.intent ? `Intent: ${intentGroup.intent}` : undefined;
    for (const item of intentGroup.urls ?? []) {
      results.push({ url: item.url ?? '', title: item.assetTitle ?? '', context: intent });
    }
  }
  for (const item of data.new?.items ?? []) {
    const date = item.dateCreated ? `New content added on ${item.dateCreated}` : 'New content';
    results.push({ url: item.url ?? '', title: item.assetTitle ?? '', context: date });
  }
  for (const item of data.similar?.items ?? []) {
    results.push({ url: item.url ?? '', title: item.assetTitle ?? '', context: item.abstract ?? 'Similar content' });
  }

  return results;
}

function isAllowedAwsDocsUrl(url: string): boolean {
  if (/^https?:\/\/docs\.aws\.amazon\.com\//.test(url)) return true;
  return SEARCH_TERM_DOMAIN_MODIFIERS.some((m) => m.regex.test(url));
}

function getPartition(): 'aws' | 'aws-cn' {
  return (process.env.AWS_DOCUMENTATION_PARTITION ?? 'aws').toLowerCase() === 'aws-cn' ? 'aws-cn' : 'aws';
}

function runPythonHelper(input: HelperRequest, timeoutMs = 45_000): Promise<HelperResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [PYTHON_HELPER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Python helper timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(`Python helper exited with code ${code}: ${stderr.trim() || 'no stderr'}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as HelperResponse;
        resolve(parsed);
      } catch (error) {
        reject(
          new Error(
            `Failed to parse Python helper output as JSON: ${error instanceof Error ? error.message : String(error)}. stderr=${stderr.trim()}`,
          ),
        );
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

let pythonHealthCheck: Promise<void> | undefined;

function ensurePythonReady(): Promise<void> {
  if (!pythonHealthCheck) {
    pythonHealthCheck = (async () => {
      const result = await runPythonHelper({ mode: 'health' }, 10_000);
      if (!result.ok) {
        throw new Error(result.error);
      }
    })();
  }
  return pythonHealthCheck;
}

function missingPythonDepsMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    `Python helper unavailable (${PYTHON_BIN}): ${detail}`,
    'Install prerequisites:',
    '- Arch: sudo pacman -S python-beautifulsoup4 python-markdownify',
    '- Ensure python3 can import: bs4, markdownify',
    'Optional override: set AWS_DOCS_PYTHON_BIN to your python executable path',
  ].join('\n');
}

async function runSelfTest(): Promise<string[]> {
  const lines: string[] = [];
  lines.push(`python_bin=${PYTHON_BIN}`);
  lines.push(`python_helper=${PYTHON_HELPER_PATH}`);

  await ensurePythonReady();
  lines.push('python_health=ok');

  const smoke = await runPythonHelper({
    mode: 'read',
    html: '<html><body><main><h1>ok</h1><p>selftest</p></main></body></html>',
  });
  if (!smoke.ok) {
    throw new Error(`python_smoke_test_failed: ${smoke.error}`);
  }
  if (!smoke.markdown?.includes('# ok')) {
    throw new Error("python_smoke_test_failed: expected markdown heading '# ok'");
  }
  lines.push('python_smoke_test=ok');

  return lines;
}

export default function awsDocsExtension(pi: ExtensionAPI) {
  const sessionId = crypto.randomUUID();
  const searchCache: SearchResponse[] = [];

  pi.on('input', async (event, ctx) => {
    if (event.text.trim() !== '/aws-docs-selftest') return { action: 'continue' as const };

    try {
      const lines = await runSelfTest();
      ctx.ui.notify('aws-docs selftest passed', 'info');
      ctx.ui.notify(lines.join(' | '), 'info');
    } catch (error) {
      ctx.ui.notify('aws-docs selftest failed', 'error');
      ctx.ui.notify(missingPythonDepsMessage(error), 'error');
    }

    return { action: 'handled' as const };
  });

  const cacheSearch = (item: SearchResponse) => {
    searchCache.unshift(item);
    if (searchCache.length > 3) searchCache.pop();
  };

  const lookupQueryId = (url: string): string | undefined => {
    for (const response of searchCache) {
      for (const result of response.search_results) {
        if (result.url === url && response.query_id) {
          return encodeURIComponent(response.query_id);
        }
      }
    }
    return undefined;
  };

  pi.registerTool({
    name: 'aws_docs_search',
    label: 'AWS Docs Search',
    description: 'Search AWS documentation using AWS docs search API',
    parameters: Type.Object({
      search_phrase: Type.String({ description: 'Search phrase' }),
      search_intent: Type.Optional(Type.String({ description: 'AWS-only intent summary (no PII)' })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 10 })),
      product_types: Type.Optional(Type.Array(Type.String())),
      guide_types: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const limit = params.limit ?? 10;
      const body: SearchApiRequest = {
        textQuery: { input: params.search_phrase },
        contextAttributes: [{ key: 'domain', value: 'docs.aws.amazon.com' }],
        acceptSuggestionBody: 'RawText',
        locales: ['en_us'],
      };

      for (const modifier of SEARCH_TERM_DOMAIN_MODIFIERS) {
        if (modifier.terms.some((term) => params.search_phrase.toLowerCase().includes(term))) {
          body.contextAttributes.push(...modifier.domains);
        }
      }
      for (const product of params.product_types ?? []) {
        body.contextAttributes.push({ key: 'aws-docs-search-product', value: product });
      }
      for (const guide of params.guide_types ?? []) {
        body.contextAttributes.push({ key: 'aws-docs-search-guide', value: guide });
      }

      let url = `${SEARCH_API_URL}?session=${sessionId}`;
      const intent = params.search_intent?.trim();
      if (intent) url += `&search_intent=${encodeURIComponent(intent.replace(/\s+/g, ' '))}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': DEFAULT_USER_AGENT,
          'x-mcp-session-id': sessionId,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const msg = `Error searching AWS docs - status code ${response.status}`;
        return { content: [{ type: 'text', text: msg }], isError: true, details: undefined };
      }

      const data = (await response.json()) as SearchApiResponse;
      const rawFacets = data.facets;
      const facets: SearchResponse['facets'] = {};

      if (rawFacets && Array.isArray(rawFacets['aws-docs-search-product'])) {
        facets.product_types = rawFacets['aws-docs-search-product'].filter((v): v is string => typeof v === 'string');
      }
      if (rawFacets && Array.isArray(rawFacets['aws-docs-search-guide'])) {
        facets.guide_types = rawFacets['aws-docs-search-guide'].filter((v): v is string => typeof v === 'string');
      }

      const searchResults: SearchResult[] = [];
      for (const [index, suggestion] of (data.suggestions ?? []).slice(0, limit).entries()) {
        const text = suggestion.textExcerptSuggestion;
        if (!text) continue;
        const metadata = text.metadata;
        const context =
          metadata?.seo_abstract ?? metadata?.abstract ?? text.summary ?? text.suggestionBody ?? undefined;
        const sectionsRaw = metadata?.sections;
        const sections = Array.isArray(sectionsRaw)
          ? sectionsRaw.filter((s): s is string => typeof s === 'string' && s.length > 0)
          : undefined;

        searchResults.push({
          rank_order: index + 1,
          url: text.link ?? '',
          title: text.title ?? '',
          context,
          sections: sections && sections.length > 0 ? sections : undefined,
        });
      }

      const result: SearchResponse = {
        search_results: searchResults,
        facets: Object.keys(facets).length > 0 ? facets : undefined,
        query_id: data.queryId ?? '',
      };
      cacheSearch(result);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: 'aws_docs_read',
    label: 'AWS Docs Read',
    description: 'Fetch AWS documentation page and convert it to Markdown',
    parameters: Type.Object({
      url: Type.String({ description: 'AWS docs URL' }),
      max_length: Type.Optional(Type.Number({ minimum: 1, maximum: 1000000, default: 5000 })),
      start_index: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const maxLength = params.max_length ?? 5000;
      const startIndex = params.start_index ?? 0;
      const urlStr = String(params.url);
      const partition = getPartition();

      if (partition === 'aws' && !isAllowedAwsDocsUrl(urlStr)) {
        return { content: [{ type: 'text', text: `Invalid URL: ${urlStr}` }], isError: true, details: undefined };
      }
      if (partition === 'aws-cn' && !/^https?:\/\/docs\.amazonaws\.cn\//.test(urlStr)) {
        return {
          content: [{ type: 'text', text: `Invalid URL for aws-cn: ${urlStr}` }],
          isError: true,
          details: undefined,
        };
      }
      if (!urlStr.endsWith('.html')) {
        return {
          content: [{ type: 'text', text: `Invalid URL: ${urlStr}. URL must end with .html` }],
          isError: true,
          details: undefined,
        };
      }

      let requestUrl = `${urlStr}?session=${sessionId}`;
      const queryId = lookupQueryId(urlStr);
      if (queryId) requestUrl += `&query_id=${queryId}`;

      const response = await fetch(requestUrl, {
        headers: {
          'user-agent': DEFAULT_USER_AGENT,
          'x-mcp-session-id': sessionId,
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        const msg = `Failed to fetch ${urlStr} - status code ${response.status}`;
        return { content: [{ type: 'text', text: msg }], isError: true, details: undefined };
      }

      const pageRaw = await response.text();
      const contentType = response.headers.get('content-type');

      if (!isHtmlContent(pageRaw, contentType)) {
        const result = formatDocumentationResult(urlStr, pageRaw, startIndex, maxLength);
        return { content: [{ type: 'text', text: result }], details: undefined };
      }

      try {
        await ensurePythonReady();
        const helperResult = await runPythonHelper({ mode: 'read', html: pageRaw });
        if (!helperResult.ok || !helperResult.markdown) {
          return {
            content: [{ type: 'text', text: helperResult.ok ? 'No markdown returned' : helperResult.error }],
            isError: true,
            details: undefined,
          };
        }
        const result = formatDocumentationResult(urlStr, helperResult.markdown, startIndex, maxLength);
        return { content: [{ type: 'text', text: result }], details: undefined };
      } catch (error) {
        return {
          content: [{ type: 'text', text: missingPythonDepsMessage(error) }],
          isError: true,
          details: undefined,
        };
      }
    },
  });

  pi.registerTool({
    name: 'aws_docs_read_sections',
    label: 'AWS Docs Read Sections',
    description: 'Read specific H2 sections from an AWS doc URL and return Markdown',
    parameters: Type.Object({
      url: Type.String({ description: 'AWS docs URL' }),
      section_titles: Type.Array(Type.String({ minLength: 1 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const urlStr = String(params.url);
      if (!isAllowedAwsDocsUrl(urlStr) || !urlStr.endsWith('.html')) {
        return { content: [{ type: 'text', text: `Invalid URL: ${urlStr}` }], isError: true, details: undefined };
      }
      if (!params.section_titles || params.section_titles.length === 0) {
        return {
          content: [{ type: 'text', text: 'section_titles cannot be empty' }],
          isError: true,
          details: undefined,
        };
      }

      let requestUrl = `${urlStr}?session=${sessionId}`;
      const queryId = lookupQueryId(urlStr);
      if (queryId) requestUrl += `&query_id=${queryId}`;

      const response = await fetch(requestUrl, {
        headers: { 'user-agent': DEFAULT_USER_AGENT, 'x-mcp-session-id': sessionId },
        redirect: 'follow',
      });
      if (!response.ok) {
        const msg = `Failed to fetch ${urlStr} - status code ${response.status}`;
        return { content: [{ type: 'text', text: msg }], isError: true, details: undefined };
      }

      const pageRaw = await response.text();
      const contentType = response.headers.get('content-type');
      if (!isHtmlContent(pageRaw, contentType)) {
        return {
          content: [
            { type: 'text', text: 'Cannot extract sections from non-HTML content. Use aws_docs_read instead.' },
          ],
          isError: true,
          details: undefined,
        };
      }

      try {
        await ensurePythonReady();
        const helperResult = await runPythonHelper({
          mode: 'sections',
          html: pageRaw,
          section_titles: params.section_titles,
        });
        if (!helperResult.ok || !helperResult.markdown) {
          return {
            content: [{ type: 'text', text: helperResult.ok ? 'No markdown returned' : helperResult.error }],
            isError: true,
            details: undefined,
          };
        }
        return { content: [{ type: 'text', text: helperResult.markdown }], details: undefined };
      } catch (error) {
        return {
          content: [{ type: 'text', text: missingPythonDepsMessage(error) }],
          isError: true,
          details: undefined,
        };
      }
    },
  });

  pi.registerTool({
    name: 'aws_docs_recommend',
    label: 'AWS Docs Recommend',
    description: 'Get AWS docs recommendations for a page URL',
    parameters: Type.Object({
      url: Type.String({ description: 'AWS docs URL' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const urlStr = String(params.url);
      const requestUrl = `${RECOMMENDATIONS_API_URL}?path=${encodeURIComponent(urlStr)}&session=${sessionId}`;
      const response = await fetch(requestUrl, {
        headers: { 'user-agent': DEFAULT_USER_AGENT },
      });
      if (!response.ok) {
        const msg = `Error getting recommendations - status code ${response.status}`;
        return { content: [{ type: 'text', text: msg }], isError: true, details: undefined };
      }
      const data = (await response.json()) as RecommendationApiResponse;
      const results = parseRecommendationResults(data);
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        details: { count: results.length },
      };
    },
  });
}
