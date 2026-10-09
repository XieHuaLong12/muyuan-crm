import { db } from '@/lib/db';
import { inquiryDate } from '@/lib/customer-date';
import { Actor, scope } from '@/lib/auth';
import { Period, periodRange, previousDate, dayKey, localDate } from '@/lib/time';
import { pipeline } from '@/lib/constants';
import { differenceInCalendarDays, isLeapYear } from 'date-fns';

export const ratio = (a: number, b: number) =>
  b === 0 ? 0 : (a / b) * 100;

export const profit = (revenue: number, cost: number) => ({
  grossProfit: revenue - cost,
  grossMargin: ratio(revenue - cost, revenue),
});

export const forecast = (
  revenue: number,
  days: number,
  totalDays: number
) => (days <= 0 ? 0 : (revenue / days) * totalDays);

type MetricCustomer = {
  isQualified: boolean | null;
  stage: string;
  contactedAt: unknown;
  firstReplyAt: unknown;
  quotedAt: unknown;
  deals: unknown[];
};

/**
 * 是否已经联系客户
 *
 * NEW = 未联系
 * INVALID = 无效客户，不参与
 * 其他阶段 = 已联系
 */
function hasBeenContacted(customer: {
  stage: string;
}) {
  return !['NEW', 'INVALID'].includes(customer.stage);
}

/**
 * 是否已经收到客户回复
 *
 * NEW = 未回复
 * CONTACTED = 未回复
 * INVALID = 排除
 *
 * 其他阶段全部算回复：
 * REPLIED
 * NEEDS_CONFIRMED
 * QUOTED
 * FOLLOW_UP
 * WON
 * PAUSED
 *
 * 不再依赖 firstReplyAt。
 * 不要求 isQualified === true。
 */
function hasReplied(customer: {
  stage: string;
}) {
  return ![
    'NEW',
    'CONTACTED',
    'INVALID',
  ].includes(customer.stage);
}

export function metrics(
  customers: MetricCustomer[],
  orders: {
    dealAmount: unknown;
    productCost: unknown;
  }[]
) {
  /**
   * 非无效客户
   *
   * 这是回复率的统计基础。
   * 包括：
   * - 待判断
   * - 有效客户
   *
   * 排除：
   * - INVALID 无效客户
   */
  const replyBase = customers.filter(
    (c) => c.stage !== 'INVALID'
  );

  /**
   * 有效客户
   *
   * 继续用于：
   * - 有效率
   * - 报价率
   * - 成交率
   *
   * 不用于限制回复率。
   */
  const valid = customers.filter(
    (c) =>
      c.isQualified === true &&
      c.stage !== 'INVALID'
  );

  /**
   * 已联系
   *
   * 非无效客户中：
   * NEW 不算
   * 其他阶段算已联系
   */
  const contacted = replyBase.filter(
    (c) => hasBeenContacted(c)
  );

  /**
   * 已回复
   *
   * 非无效客户中：
   * NEW 不算
   * CONTACTED 不算
   * 其他阶段全部算回复
   */
  const replied = replyBase.filter(
    (c) => hasReplied(c)
  );

  const revenue = orders.reduce(
    (sum, deal) =>
      sum + Number(deal.dealAmount),
    0
  );

  const cost = orders.reduce(
    (sum, deal) =>
      sum + Number(deal.productCost),
    0
  );

  const quoted = valid.filter(
    (c) =>
      c.quotedAt ||
      c.stage === 'QUOTED'
  );

  const won = valid.filter(
    (c) => c.deals.length > 0
  );

  return {
    inquiries: customers.length,

    qualified: valid.length,

    contacted: contacted.length,

    replied: replied.length,

    quoted: quoted.length,

    won: won.length,

    revenue,

    cost,

    grossProfit:
      revenue - cost,

    kpis: [
      /**
       * 1. 新增询盘
       */
      customers.length,

      /**
       * 2. 客户有效率
       *
       * 已判断有效客户 ÷ 总询盘
       */
      ratio(
        valid.length,
        customers.length
      ),

      /**
       * 3. 客户回复率
       *
       * 已回复的非无效客户
       * ÷
       * 全部非无效客户
       *
       * 待判断客户正常参与。
       * INVALID 不参与。
       */
      ratio(
        replied.length,
        replyBase.length
      ),

      /**
       * 4. 报价率
       *
       * 已报价有效客户 ÷ 有效客户
       */
      ratio(
        quoted.length,
        valid.length
      ),

      /**
       * 5. 成交率
       *
       * 已成交有效客户 ÷ 有效客户
       */
      ratio(
        won.length,
        valid.length
      ),

      /**
       * 6. 毛利率
       */
      ratio(
        revenue - cost,
        revenue
      ),
    ],
  };
}
export async function dashboard(
  user: Actor,
  period: Period,
  date: string,
  currency: string
) {
  const setting =
    await db.setting.findUniqueOrThrow({
      where: {
        id: 'system',
      },
    });

  const tz =
    setting.timezone;

  const range =
    periodRange(
      period,
      date,
      tz
    );

  const previous =
    periodRange(
      period,
      previousDate(
        period,
        date
      ),
      tz
    );

  const yearRange =
    periodRange(
      'YEAR',
      date,
      tz
    );

  // Only load what the report reads: inquiries and quotes inside the compared periods and the year,
  // plus customers whose next follow-up is due by today — not the whole customer base.
  const window = {
    gte: new Date(Math.min(range.start.getTime(), previous.start.getTime(), yearRange.start.getTime())),
    lt: new Date(Math.max(range.end.getTime(), previous.end.getTime(), yearRange.end.getTime())),
  };
  const tomorrow = new Date(`${dayKey(new Date(), tz)}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dueBy = localDate(`${tomorrow.toISOString().slice(0, 10)}T00:00`, tz);

  const [
    customers,
    orders,
    targets,
  ] = await Promise.all([
    db.customer.findMany({
      where: {
        AND: [
          scope(user),
          {
            OR: [
              { inquiryAt: window },
              { inquiryAt: null, createdAt: window },
              { quotedAt: window },
              { nextFollowUpAt: { lt: dueBy } },
            ],
          },
        ],
      },

      include: {
        deals: {
          select: {
            id: true,
          },
        },

        owner: {
          select: {
            name: true,
          },
        },

        stageHistory: true,
      },
    }),

    db.deal.findMany({
      where: {
        currency,

        dealDate: window,

        customer:
          scope(user),
      },

      include: {
        customer: {
          select: {
            id: true,
            name: true,
            country: true,
            source: true,
          },
        },
      },

      orderBy: {
        dealDate:
          'desc',
      },
    }),

    db.salesTarget.findMany({
      where: {
        year:
          range.year,

        currency,
      },
    }),
  ]);

  const between = (
    d: Date,
    r: {
      start: Date;
      end: Date;
    }
  ) =>
    d >= r.start &&
    d < r.end;

  /**
   * 当前所选周期内产生询盘的客户
   */
  const cohort =
    customers.filter(
      (c) =>
        between(
          inquiryDate(c),
          range
        )
    );

  /**
   * 当前周期成交订单
   */
  const periodOrders =
    orders.filter(
      (d) =>
        between(
          d.dealDate,
          range
        )
    );

  const current =
    metrics(
      cohort,
      periodOrders
    );

  const prev =
    metrics(
      customers.filter(
        (c) =>
          between(
            inquiryDate(c),
            previous
          )
      ),

      orders.filter(
        (d) =>
          between(
            d.dealDate,
            previous
          )
      )
    );

  const target =
    targets.find(
      (t) =>
        t.periodKey ===
        range.key
    );

  const annualTarget =
    targets.find(
      (t) =>
        t.periodKey ===
        `YEAR-${range.year}`
    );

  const today =
    dayKey(
      new Date(),
      tz
    );

  const now =
    new Date();

  const annualRevenue =
    orders
      .filter(
        (d) =>
          between(
            d.dealDate,
            yearRange
          ) &&
          d.dealDate <= now
      )
      .reduce(
        (sum, deal) =>
          sum +
          Number(
            deal.dealAmount
          ),
        0
      );

  const year =
    Number(
      date.slice(0, 4)
    );

  const elapsed =
    year <
    Number(
      today.slice(0, 4)
    )
      ? isLeapYear(year)
        ? 366
        : 365
      : year >
          Number(
            today.slice(0, 4)
          )
        ? 0
        : differenceInCalendarDays(
            new Date(today),
            new Date(
              `${year}-01-01`
            )
          ) + 1;

  const targetValue =
    Number(
      target?.targetRevenue ??
        0
    );

  const annualValue =
    Number(
      annualTarget?.targetRevenue ??
        0
    );

  const trend = [];

  const bucketCount =
    period === 'YEAR'
      ? 12
      : period === 'WEEK'
        ? 7
        : Math.ceil(
            differenceInCalendarDays(
              range.end,
              range.start
            ) / 7
          );

  for (
    let i = 0;
    i < bucketCount;
    i++
  ) {
    let start: Date;
    let end: Date;
    let label: string;

    if (
      period === 'YEAR'
    ) {
      const r =
        periodRange(
          'MONTH',

          `${year}-${String(
            i + 1
          ).padStart(
            2,
            '0'
          )}-01`,

          tz
        );

      start =
        r.start;

      end =
        r.end;

      label =
        `${i + 1}月`;
    } else {
      start =
        new Date(
          range.start.getTime() +
            i *
              (
                period ===
                'WEEK'
                  ? 1
                  : 7
              ) *
              86400000
        );

      end =
        new Date(
          Math.min(
            range.end.getTime(),

            start.getTime() +
              (
                period ===
                'WEEK'
                  ? 1
                  : 7
              ) *
                86400000
          )
        );

      label =
        period ===
        'WEEK'
          ? [
              '周一',
              '周二',
              '周三',
              '周四',
              '周五',
              '周六',
              '周日',
            ][i]
          : `第${i + 1}周`;
    }

    const cs =
      customers.filter(
        (c) =>
          between(
            inquiryDate(c),
            {
              start,
              end,
            }
          )
      );

    const ds =
      orders.filter(
        (d) =>
          between(
            d.dealDate,
            {
              start,
              end,
            }
          )
      );

    const m =
      metrics(
        cs,
        ds
      );

    trend.push({
      label,

      销售额:
        m.revenue,

      毛利润:
        m.grossProfit,

      询盘:
        m.inquiries,

      有效客户:
        m.qualified,

      报价:
        customers.filter(
          (c) =>
            c.quotedAt &&
            between(
              c.quotedAt,
              {
                start,
                end,
              }
            )
        ).length,

      成交:
        new Set(
          ds.map(
            (d) =>
              d.customerId
          )
        ).size,

      目标:
        period ===
        'YEAR'
          ? Number(
              targets.find(
                (t) =>
                  t.periodKey ===
                  `MONTH-${year}-${i + 1}`
              )
                ?.targetRevenue ??
                0
            )
          : 0,
    });
  }

  /**
   * 销售漏斗
   *
   * NEW：
   * 当前周期全部询盘
   *
   * CONTACTED：
   * 当前阶段不是 NEW
   *
   * REPLIED：
   * 当前阶段不是 NEW / CONTACTED
   *
   * 注意：
   * 回复判断完全按照当前阶段执行。
   * 不再使用 firstReplyAt 作为兜底。
   */
  const funnel =
    pipeline.map(
      (stage, i) => {
        const count =
          cohort.filter(
            (c) =>
              stage ===
              'NEW'
                ? true

                : stage ===
                    'CONTACTED'
                  ? hasBeenContacted(
                      c
                    )

                  : stage ===
                      'REPLIED'
                    ? hasReplied(
                        c
                      )

                    : stage ===
                        'NEEDS_CONFIRMED'
                      ? Boolean(
                          c.needsConfirmedAt
                        )

                    : stage ===
                        'QUOTED'
                      ? Boolean(
                          c.quotedAt
                        )

                    : stage ===
                        'WON'
                      ? c.deals
                          .length >
                        0

                    : c.stageHistory.some(
                        (h) =>
                          h.toStage ===
                          'FOLLOW_UP'
                      )
          ).length;

        return {
          stage,
          count,
          index: i,
        };
      }
    );

  const distribution = (
    field:
      | 'source'
      | 'country'
  ) =>
    Array.from(
      new Set([
        ...cohort.map(
          (c) =>
            c[field]
        ),

        ...periodOrders.map(
          (d) =>
            d.customer[
              field
            ]
        ),
      ])
    )
      .map(
        (name) => {
          const cs =
            cohort.filter(
              (c) =>
                c[field] ===
                name
            );

          const ds =
            periodOrders.filter(
              (d) =>
                d.customer[
                  field
                ] ===
                name
            );

          const m =
            metrics(
              cs,
              ds
            );

          return {
            name,

            inquiries:
              cs.length,

            qualified:
              m.qualified,

            rate:
              ratio(
                m.qualified,
                cs.length
              ),

            won:
              new Set(
                ds.map(
                  (d) =>
                    d.customerId
                )
              ).size,

            revenue:
              m.revenue,
          };
        }
      )
      .sort(
        (a, b) =>
          b.inquiries -
          a.inquiries
      );

  return {
    period,

    date,

    currency,

    range: {
      start:
        range.start,

      end:
        range.end,
    },

    current,

    previous:
      prev,

    target:
      targetValue,

    completion:
      ratio(
        current.revenue,
        targetValue
      ),

    remaining:
      Math.max(
        0,
        targetValue -
          current.revenue
      ),

    excess:
      Math.max(
        0,
        current.revenue -
          targetValue
      ),

    annual: {
      target:
        annualValue,

      revenue:
        annualRevenue,

      forecast:
        forecast(
          annualRevenue,
          elapsed,
          isLeapYear(year)
            ? 366
            : 365
        ),
    },

    trend,

    funnel,

    sources:
      distribution(
        'source'
      ),

    countries:
      distribution(
        'country'
      ),

    today:
      customers.filter(
        (c) =>
          c.nextFollowUpAt &&
          dayKey(
            c.nextFollowUpAt,
            tz
          ) === today
      ),

    overdue:
      customers.filter(
        (c) =>
          c.nextFollowUpAt &&
          dayKey(
            c.nextFollowUpAt,
            tz
          ) < today
      ).length,

    recentDeals:
      periodOrders.slice(
        0,
        6
      ),

    targetConfigured:
      Boolean(target),
  };
}
