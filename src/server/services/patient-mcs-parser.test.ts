import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildMcsTimelinePayload, inferMcsProjectIdFromDocument } from './patient-mcs-parser';

describe('patient-mcs parser', () => {
  it('parses project metadata and timeline messages from HTML', () => {
    const dom = new JSDOM(`
      <html>
        <body>
          <h1 class="header_title">板屋 美恵子：年長者の里 | 中央町おだクリニック</h1>
          <div class="card_memo"><span>年長者の里</span></div>
          <div class="tl_member_count">9人</div>
          <div class="post" id="message-68409128">
            <h2 class="item_name"><a>篠原 陽子</a></h2>
            <h3 class="item_desc">看護師（年長者の里訪問看護ステーション）</h3>
            <time>12:12</time>
            <p class="msg_body">お世話になります。</p>
            <div class="message_reply_number"><a>返信 2件</a></div>
            <div class="reaction_times"><a>1</a></div>
          </div>
        </body>
      </html>
    `, {
      url: 'https://www.medical-care.net/projects/medical/57886227',
    });

    const payload = buildMcsTimelinePayload(dom.window.document, {
      sourceUrl: 'https://www.medical-care.net/patients/2463520',
      mcsPatientId: '2463520',
      mcsPatientUrl: 'https://www.medical-care.net/patients/2463520',
      mcsProjectId: '57886227',
      mcsProjectUrl: 'https://www.medical-care.net/projects/medical/57886227',
    });

    expect(payload.projectTitle).toContain('板屋 美恵子');
    expect(payload.projectMemo).toBe('年長者の里');
    expect(payload.memberCount).toBe(9);
    expect(payload.messages).toEqual([
      {
        sourceMessageId: '68409128',
        authorName: '篠原 陽子',
        authorDescriptor: '看護師（年長者の里訪問看護ステーション）',
        postedAtLabel: '12:12',
        body: 'お世話になります。',
        reactionCount: 1,
        replyCount: 2,
        sortOrder: 0,
        sourceUrl: 'https://www.medical-care.net/projects/medical/57886227#message-68409128',
      },
    ]);
  });

  it('infers a project ID from the patient-side medical timeline DOM', () => {
    const dom = new JSDOM(`
      <html>
        <body>
          <a class="ng-star-inserted">医療･介護側</a>
          <a href="/invitation/users/check/medical/57886227">＋招待</a>
        </body>
      </html>
    `, {
      url: 'https://www.medical-care.net/patients/2463520',
    });

    expect(inferMcsProjectIdFromDocument(dom.window.document)).toBe('57886227');
  });

  it('infers a project ID from patient-side unavailable URLs', () => {
    const dom = new JSDOM('<html><body></body></html>', {
      url: 'https://www.medical-care.net/projects/unavailable/57886227/patient',
    });

    expect(inferMcsProjectIdFromDocument(dom.window.document)).toBe('57886227');
  });

  it('uses the canonical project URL when the timeline is rendered inside a patient page', () => {
    const dom = new JSDOM(`
      <html>
        <body>
          <a href="/invitation/users/check/medical/57886227">＋招待</a>
          <div class="post" id="message-68409128">
            <h2 class="item_name"><a>篠原 陽子</a></h2>
            <time>12:12</time>
            <p class="msg_body">お世話になります。</p>
          </div>
        </body>
      </html>
    `, {
      url: 'https://www.medical-care.net/patients/2463520',
    });

    const payload = buildMcsTimelinePayload(dom.window.document, {
      sourceUrl: 'https://www.medical-care.net/patients/2463520',
      mcsPatientId: '2463520',
      mcsPatientUrl: 'https://www.medical-care.net/patients/2463520',
      mcsProjectId: '57886227',
      mcsProjectUrl: 'https://www.medical-care.net/projects/medical/57886227',
    });

    expect(payload.mcsProjectUrl).toBe('https://www.medical-care.net/projects/medical/57886227');
    expect(payload.messages[0]?.sourceUrl).toBe(
      'https://www.medical-care.net/projects/medical/57886227#message-68409128'
    );
  });

  it('infers a project ID from framework-specific href attributes', () => {
    const dom = new JSDOM(`
      <html>
        <body>
          <a ng-reflect-href="/projects/medical/57886227">医療･介護側</a>
          <a data-href="/projects/medical/57886228">別導線</a>
        </body>
      </html>
    `, {
      url: 'https://www.medical-care.net/patients/2463520',
    });

    expect(inferMcsProjectIdFromDocument(dom.window.document)).toBe('57886227');
  });

  it('falls back to data-based message ids when post ids are absent', () => {
    const dom = new JSDOM(`
      <html>
        <body>
          <div class="post" data-message-id="68409128">
            <h2 class="item_name"><a>篠原 陽子</a></h2>
            <time>12:12</time>
            <p class="msg_body">お世話になります。</p>
          </div>
        </body>
      </html>
    `, {
      url: 'https://www.medical-care.net/projects/medical/57886227',
    });

    const payload = buildMcsTimelinePayload(dom.window.document, {
      sourceUrl: 'https://www.medical-care.net/patients/2463520',
      mcsPatientId: '2463520',
      mcsPatientUrl: 'https://www.medical-care.net/patients/2463520',
      mcsProjectId: '57886227',
      mcsProjectUrl: 'https://www.medical-care.net/projects/medical/57886227',
    });

    expect(payload.messages[0]?.sourceMessageId).toBe('68409128');
    expect(payload.messages[0]?.sourceUrl).toBe(
      'https://www.medical-care.net/projects/medical/57886227#message-68409128'
    );
  });
});
