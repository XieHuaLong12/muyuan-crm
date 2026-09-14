import {
  MetaSubmission,
  metaFields,
  MetaField,
} from '@/lib/meta-import';

function safeParseObject(value: string) {
  try {
    const parsed = JSON.parse(value);

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return {
        data: parsed as Record<string, unknown>,
        error: false,
      };
    }

    return {
      data: {} as Record<string, unknown>,
      error: true,
    };
  } catch {
    return {
      data: {} as Record<string, unknown>,
      error: true,
    };
  }
}

function safeParseArray(value: string) {
  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return {
        data: parsed.map(String),
        error: false,
      };
    }

    return {
      data: [] as string[],
      error: true,
    };
  } catch {
    return {
      data: [] as string[],
      error: true,
    };
  }
}

export function LeadHistory({
  submissions,
  tz,
}: {
  submissions: MetaSubmission[];
  tz: string;
}) {
  if (!submissions.length) {
    return null;
  }

  const maxOrdinal = Math.max(
    ...submissions.map((s) => s.ordinal)
  );

  return (
    <section className="card">
      <h3>
        留资历史 · 共 {maxOrdinal} 次
      </h3>

      {submissions.map((s) => {
        const valuesResult =
          safeParseObject(s.values);

        const rawResult =
          safeParseObject(s.raw);

        const pendingResult =
          safeParseArray(
            s.translationPending
          );

        const values =
          valuesResult.data;

        const raw =
          rawResult.data;

        const pending =
          pendingResult.data;

        const hasBrokenData =
          valuesResult.error ||
          rawResult.error ||
          pendingResult.error;

        return (
          <article
            className="lead-history"
            key={s.id}
          >
            <strong>
              第 {s.ordinal} 次留资 ·{' '}
              {new Date(
                s.occurredAt
              ).toLocaleDateString(
                'zh-CN',
                {
                  timeZone: tz,
                }
              )}
            </strong>

            {hasBrokenData && (
              <p className="notice">
                ⚠️
                该条历史留资数据存在格式异常，系统已自动跳过损坏内容，不影响客户资料查看和编辑。
              </p>
            )}

            <p className="muted">
              {typeof values.source ===
                'string' &&
              values.source
                ? values.source
                : '来源未填写'}
              {' · '}
              {typeof values.adName ===
                'string' &&
              values.adName
                ? values.adName
                : '广告未填写'}
            </p>

            {pending.length >
              0 && (
              <p className="notice">
                翻译待处理：
                {pending.join('、')}
                （保留原文）
              </p>
            )}

            {!valuesResult.error && (
              <dl className="import-original">
                {Object.entries(
                  values
                )
                  .filter(
                    ([key, value]) =>
                      Boolean(
                        value
                      ) &&
                      ![
                        'inquiryAt',
                        'source',
                        'adName',
                      ].includes(
                        key
                      )
                  )
                  .map(
                    ([
                      key,
                      value,
                    ]) => (
                      <div
                        key={key}
                      >
                        <dt>
                          {metaFields[
                            key as MetaField
                          ] ??
                            key}
                        </dt>

                        <dd>
                          {String(
                            value ??
                              ''
                          )}
                        </dd>
                      </div>
                    )
                  )}
              </dl>
            )}

            {!rawResult.error && (
              <details>
                <summary>
                  原始 CSV 回答 ·{' '}
                  {s.filename}
                </summary>

                <dl className="import-original">
                  {Object.entries(
                    raw
                  ).map(
                    ([
                      key,
                      value,
                    ]) => (
                      <div
                        key={key}
                      >
                        <dt>
                          {key}
                        </dt>

                        <dd>
                          {value ===
                            null ||
                          value ===
                            undefined ||
                          value ===
                            ''
                            ? '—'
                            : String(
                                value
                              )}
                        </dd>
                      </div>
                    )
                  )}
                </dl>
              </details>
            )}

            {rawResult.error && (
              <p className="muted">
                原始 CSV
                数据无法解析，后续可以从旧数据库重新恢复。
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
