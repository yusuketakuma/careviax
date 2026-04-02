export const MCS_TIMELINE_SELECTORS = {
  messagePosts: 'div.post[id^="message-"], div.post[data-message-id], div.post[data-id]',
  replyAnchor: '.message_reply_number a',
  reactionTimes: '.reaction_times a',
  reactionBadge: '.reaction_icon span',
  messageBody: 'p.msg_body',
  authorName: 'h2.item_name a',
  authorDescriptor: 'h3.item_desc',
  postedAt: 'time',
  projectTitle: '.header_title',
  projectMemo: '.card_memo span',
  memberCount: '.tl_member_count',
  scrollWrapper: '#scroll_wrapper',
} as const;

export type ScrapedMcsMessage = {
  sourceMessageId: string;
  authorName: string;
  authorDescriptor: string | null;
  postedAtLabel: string;
  body: string;
  reactionCount: number;
  replyCount: number;
  sortOrder: number;
  sourceUrl: string;
};

export type ScrapedMcsTimeline = {
  sourceUrl: string;
  mcsPatientId: string | null;
  mcsPatientUrl: string | null;
  mcsProjectId: string;
  mcsProjectUrl: string;
  projectTitle: string | null;
  projectMemo: string | null;
  memberCount: number | null;
  messages: ScrapedMcsMessage[];
};

export type ScrapedMcsTimelineArgs = {
  sourceUrl: string;
  mcsPatientId: string | null;
  mcsPatientUrl: string | null;
  mcsProjectId: string;
  mcsProjectUrl: string;
};

type SelectorMap = typeof MCS_TIMELINE_SELECTORS;

const PROJECT_ID_PATTERNS = [
  /\/projects\/medical\/(\d+)/,
  /\/projects\/unavailable\/(\d+)/,
  /\/invitation\/users\/check\/medical\/(\d+)/,
] as const;

function readText(value: Element | null | undefined) {
  return value?.textContent?.replace(/\s+/g, ' ').trim() || null;
}

function parseCount(value: Element | null | undefined) {
  const matched = readText(value)?.match(/(\d+)/);
  return matched ? Number(matched[1]) : 0;
}

function readMessageId(post: Element, index: number) {
  const rawId =
    post.getAttribute('id') ??
    post.getAttribute('data-message-id') ??
    post.getAttribute('data-id') ??
    '';
  const normalized = rawId.replace(/^message-/, '').trim();

  return normalized.length > 0 ? normalized : `message-${index}`;
}

function readProjectIdFromValue(value: string | null | undefined) {
  if (!value) return null;

  for (const pattern of PROJECT_ID_PATTERNS) {
    const matched = value.match(pattern);
    if (matched?.[1]) {
      return matched[1];
    }
  }

  return null;
}

export function inferMcsProjectIdFromDocument(doc: Document) {
  const locationHref =
    typeof doc.defaultView?.location?.href === 'string' ? doc.defaultView.location.href : null;
  const locationPath =
    typeof doc.defaultView?.location?.pathname === 'string'
      ? doc.defaultView.location.pathname
      : null;

  const directMatch =
    readProjectIdFromValue(locationHref) ??
    readProjectIdFromValue(locationPath) ??
    readProjectIdFromValue(doc.body?.innerHTML ?? null);
  if (directMatch) {
    return directMatch;
  }

  for (const anchor of Array.from(doc.querySelectorAll('a'))) {
    const projectId =
      readProjectIdFromValue(anchor.getAttribute('href')) ??
      readProjectIdFromValue(anchor.getAttribute('ng-reflect-href')) ??
      readProjectIdFromValue(anchor.getAttribute('ng-reflect-router-link')) ??
      readProjectIdFromValue(anchor.getAttribute('routerlink')) ??
      readProjectIdFromValue(anchor.getAttribute('data-href')) ??
      readProjectIdFromValue(anchor.getAttribute('onclick'));

    if (projectId) {
      return projectId;
    }
  }

  return null;
}

export function buildMcsTimelinePayload(
  doc: Document,
  args: ScrapedMcsTimelineArgs,
  selectors: SelectorMap = MCS_TIMELINE_SELECTORS
): ScrapedMcsTimeline {
  const liveProjectId = inferMcsProjectIdFromDocument(doc);
  const locationHref =
    typeof doc.defaultView?.location?.href === 'string' ? doc.defaultView.location.href : null;
  const projectUrl =
    locationHref && liveProjectId && readProjectIdFromValue(locationHref) === liveProjectId
      ? locationHref
      : args.mcsProjectUrl;

  const messages = Array.from(doc.querySelectorAll(selectors.messagePosts)).map((post, index) => {
    const messageId = readMessageId(post, index);
    const replyAnchor = post.querySelector(selectors.replyAnchor);
    const reactionTimes = post.querySelector(selectors.reactionTimes);
    const reactionBadge = post.querySelector(selectors.reactionBadge);
    const body = Array.from(post.querySelectorAll(selectors.messageBody))
      .map((node) => node.textContent?.trim() || '')
      .filter(Boolean)
      .join('\n\n');

    return {
      sourceMessageId: messageId,
      authorName: readText(post.querySelector(selectors.authorName)) || '不明',
      authorDescriptor: readText(post.querySelector(selectors.authorDescriptor)),
      postedAtLabel: readText(post.querySelector(selectors.postedAt)) || '',
      body,
      reactionCount: parseCount(reactionTimes) || parseCount(reactionBadge),
      replyCount: parseCount(replyAnchor),
      sortOrder: index,
      sourceUrl: `${projectUrl}#message-${messageId}`,
    };
  });

  return {
    sourceUrl: args.sourceUrl,
    mcsPatientId: args.mcsPatientId,
    mcsPatientUrl: args.mcsPatientUrl,
    mcsProjectId: args.mcsProjectId,
    mcsProjectUrl: projectUrl,
    projectTitle: readText(doc.querySelector(selectors.projectTitle)),
    projectMemo: readText(doc.querySelector(selectors.projectMemo)),
    memberCount: parseCount(doc.querySelector(selectors.memberCount)),
    messages,
  };
}
