"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Plus, Target, Users, Clock3, UserRoundCog } from "lucide-react";
import { Header, Card, Table, Badge, Button, Input, EmptyState } from "@/components/ui/bos";
import { Dialog } from "@/components/ui/dialog";
import { api, money, dateTimeText } from "@/lib/client";
import type { SalesPerformance } from "@/services/sales-team-service";
import type { salesAccounts } from "@/services/sales-account-service";
import { METRIC_NOTES } from "@/lib/metric-notes";

type Accounts = Awaited<ReturnType<typeof salesAccounts>>;
export function SalesTeam({ data, accounts = [], admin = false, initialTab = "performance" }: { data: SalesPerformance; accounts?: Accounts; admin?: boolean; initialTab?: "performance" | "accounts" }) {
  const router = useRouter();
  const [tab, setTab] = useState<string>(initialTab),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [targetId, setTargetId] = useState<string>(),
    [editor, setEditor] = useState<{ id?: string; action: "create" | "password" | "name" | "status" }>();
  const goal = data.rows.find((row) => row.id === targetId),
    account = accounts.find((row) => row.id === editor?.id);
  const sum = (field: "newCustomers" | "pendingFirstContact" | "overdueFirstContact" | "deals") =>
    data.rows.reduce((total, row) => total + row[field], 0);
  async function save(path: string, method: "POST" | "PATCH" | "PUT", body: unknown, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, method, body);
      setNotice(message);
      setEditor(undefined);
      setTargetId(undefined);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bos-team-page">
      <Header
        eyebrow={admin ? "MANAGEMENT · 销售团队" : "SALES · 我的业绩"}
        title={admin ? "看清团队进展，及时推进。" : "我的销售业绩"}
        description={admin ? "按销售查看真实客户进展、首联时效和成交，管理月度目标与账号。" : "查看自己的客户进展、成交和月度目标。"}
        actions={
          admin ? (
            <Button
              variant="primary"
              onClick={() => {
                setError("");
                setEditor({ action: "create" });
              }}
            >
              <Plus size={16} />
              添加账号
            </Button>
          ) : undefined
        }
      />
      {admin && (
        <nav className="bos-tabs" aria-label="销售团队管理">
          <button aria-current={tab === "performance" ? "page" : undefined} onClick={() => setTab("performance")}>
            <Target size={15} />
            业绩与跟进
          </button>
          <button aria-current={tab === "accounts" ? "page" : undefined} onClick={() => setTab("accounts")}>
            <UserRoundCog size={15} />
            账号管理 <span>{accounts.length}</span>
          </button>
        </nav>
      )}
      {notice && (
        <p className="bos-team-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="bos-sales-error" role="alert">
          {error}
        </p>
      )}
      {tab === "performance" && (
        <>
          <form className="bos-team-filter" action={admin ? "/team" : "/sales/performance"}>
            <label>
              统计月份
              <Input aria-label="统计月份" type="month" name="month" defaultValue={data.month} min="2000-01" max="2200-12" required />
            </label>
            <label>
              成交币种
              <select aria-label="成交币种" name="currency" defaultValue={data.currency}>
                <option value="CNY">人民币 CNY</option>
                <option value="USD">美元 USD</option>
                <option value="EUR">欧元 EUR</option>
              </select>
            </label>
            <Button type="submit">查看业绩</Button>
            <span>成交额按成交日期统计，各币种分别计算。</span>
          </form>
          <div className="bos-team-metrics">
            {[
              // Administrators see company totals (the same numbers as the cockpit), split into salespeople and the rest.
              { label: "本月新增询盘", value: data.company?.newCustomers ?? sum("newCustomers"), icon: Users,
                detail: data.company && data.others ? `销售名下 ${sum("newCustomers")} · 待分配或管理员名下 ${data.others.newCustomers}` : "所选月份真实记录" },
              { label: "待首次联系", value: sum("pendingFirstContact"), icon: Clock3, detail: "当前待处理客户" },
              { label: "首联已逾期", value: sum("overdueFirstContact"), icon: Clock3, detail: "当前待处理客户" },
              { label: "本月成交笔数", value: data.company?.deals ?? sum("deals"), icon: Target,
                detail: data.company ? `销售名下 ${sum("deals")} 笔 · ${data.currency}` : "所选月份真实记录" },
            ].map(({ label, value, icon: Icon, detail }) => (
              <Card key={label}>
                <span>
                  <Icon size={17} />
                  {label}
                </span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </Card>
            ))}
          </div>
          <Card>
            <div className="bos-team-heading">
              <div>
                <h2>{admin ? "每位销售的进展" : "我的进展与目标"}</h2>
                <p>客户进展按当前负责人；新增询盘按询盘日期；报价按发送人；新成交保留成交时的销售负责人。</p>
                {data.targetSummary && (
                  <p>
                    {data.month} 个人目标合计 {money(data.targetSummary.personal, data.currency)}
                    {data.targetSummary.company === null
                      ? " · 公司当月目标未设置（或币种不同）"
                      : ` · 公司当月目标 ${money(data.targetSummary.company, data.currency)}${Number(data.targetSummary.personal) < Number(data.targetSummary.company) ? "，个人目标合计尚未覆盖公司目标" : ""}`}
                  </p>
                )}
              </div>
              {admin && (
                <Link href="/customers?assign=pending" className="bos-text-link">
                  分配与转交客户 <ArrowUpRight size={14} />
                </Link>
              )}
            </div>
            {data.rows.length ? (
              <Table
                caption="销售业绩与目标"
                headings={[
                  "销售",
                  "本月分配",
                  "新增 / 有效",
                  "已联系",
                  "已发报价客户",
                  "成交额 / 笔数",
                  "月度目标",
                  "完成率",
                  "首联平均时长",
                  "首联按时率",
                  "首联逾期",
                  "新询盘成交率",
                  "标记无效 / 暂停 / 流失",
                  ...(admin ? ["操作"] : []),
                ]}
              >
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      {!row.isActive && <Badge tone="warning">已停用</Badge>}
                    </td>
                    <td>{row.assigned}</td>
                    <td>
                      {row.newCustomers} / {row.qualified}
                    </td>
                    <td>{row.contacted}</td>
                    <td>{row.quoted}</td>
                    <td>
                      {money(row.revenue, data.currency)}
                      <small>
                        {row.deals} 笔{row.legacyDeals > 0 ? ` · ${row.legacyDeals} 笔历史归属` : ""}
                      </small>
                    </td>
                    <td>{row.target ? money(row.target.amount, data.currency) : "未设置"}</td>
                    <td>{row.completion === null ? "—" : `${row.completion}%`}</td>
                    <td>
                      {row.averageFirstContactMinutes === null
                        ? "—"
                        : row.averageFirstContactMinutes < 60
                          ? `${row.averageFirstContactMinutes} 分钟`
                          : `${(row.averageFirstContactMinutes / 60).toFixed(1)} 小时`}
                    </td>
                    <td>{row.firstContactOnTime === null ? "—" : `${row.firstContactOnTime}%`}</td>
                    <td>{row.overdueFirstContact > 0 ? <Badge tone="warning">{row.overdueFirstContact} 位</Badge> : 0}</td>
                    <td>{row.conversion === null ? "—" : `${row.conversion}%`}</td>
                    <td>{row.closedByOwner}</td>
                    {admin && (
                      <td>
                        <Button
                          disabled={!row.isActive}
                          onClick={() => {
                            setError("");
                            setTargetId(row.id);
                          }}
                        >
                          设置目标
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {data.others && (
                  <tr className="bos-team-others">
                    <td><strong>待分配 / 管理员名下</strong></td>
                    <td>—</td>
                    <td>{data.others.newCustomers} / {data.others.qualified}</td>
                    <td>—</td>
                    <td>—</td>
                    <td>
                      {money(data.others.revenue, data.currency)}
                      <small>{data.others.deals} 笔</small>
                    </td>
                    {Array.from({ length: 7 }, (_, i) => <td key={i}>—</td>)}
                    {admin && <td />}
                  </tr>
                )}
              </Table>
            ) : (
              <EmptyState title="还没有销售账号" description="添加销售账号后，这里会显示每个人的客户进展和目标。" />
            )}
            <p className="bos-footnote">
              {METRIC_NOTES.newInquiries}{METRIC_NOTES.qualified}
              首联按时率：本月开始计时的首联中，在期限内联系的比例（广告线索期限为 {data.adLeadFirstContactMinutes} 分钟）。首联时长仅统计有分配时间和联系记录的新流程客户。历史成交未保存销售快照时，按客户当前负责人展示并标记“历史归属”；转交客户不会改变新成交的销售快照。
            </p>
          </Card>
          <div className="bos-team-bottom">
            <Card>
              <div className="bos-team-heading">
                <div>
                  <h2>{admin ? "需要关注的首联" : "我的待首联客户"}</h2>
                  <p>{data.pendingTotal} 位待联系 · 显示最早到期的前 100 位</p>
                </div>
                <Link className="bos-text-link" href="/sales?queue=new">
                  打开新线索 <ArrowUpRight size={14} />
                </Link>
              </div>
              {data.pending.length ? (
                <div className="bos-team-pending">
                  {data.pending.map((customer) => (
                    <Link href={`/customers/${encodeURIComponent(customer.id)}`} key={customer.id}>
                      <div>
                        <strong>{customer.name}</strong>
                        <small>
                          {admin ? `${data.rows.find((row) => row.id === customer.ownerId)?.name || "销售"} · ` : ""}期限{" "}
                          {dateTimeText(customer.dueAt, data.timezone)}
                        </small>
                      </div>
                      <Badge tone={customer.overdue ? "warning" : "neutral"}>{customer.overdue ? "已逾期" : "待首联"}</Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title="暂无待首联客户" description="新分配客户会自动进入首联任务，记录联系后会从这里移除。" />
              )}
            </Card>
            {admin && (
              <Card>
                <h2>首联安排</h2>
                <p className="bos-footnote">客户分配给负责人（或未联系客户转交）时开始计算首联期限。调整期限只影响之后的新分配，不改已有任务。</p>
                <form
                  className="bos-team-policy"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void save("sales-team/policy", "PUT", { hours: Number(f.get("hours")) }, "首联期限已更新，之后的新分配将使用新期限。");
                  }}
                >
                  <label>
                    首次联系期限
                    <Input
                      key={data.firstContactHours}
                      name="hours"
                      aria-label="首次联系期限（小时）"
                      type="number"
                      min="1"
                      max="168"
                      defaultValue={data.firstContactHours}
                      required
                    />
                  </label>
                  <span>小时</span>
                  <Button type="submit" disabled={busy}>
                    保存
                  </Button>
                </form>
                <form
                  className="bos-team-policy"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void save("sales-team/policy", "PUT", { adLeadMinutes: Number(f.get("adLeadMinutes")) }, "广告线索首联期限已更新，之后的新分配将使用新期限。");
                  }}
                >
                  <label>
                    广告线索首次联系期限（24 小时内的 Meta 表单 / WhatsApp 广告留资）
                    <Input
                      key={data.adLeadFirstContactMinutes}
                      name="adLeadMinutes"
                      aria-label="广告线索首次联系期限（分钟）"
                      type="number"
                      min="1"
                      max="1440"
                      defaultValue={data.adLeadFirstContactMinutes}
                      required
                    />
                  </label>
                  <span>分钟</span>
                  <Button type="submit" disabled={busy}>
                    保存
                  </Button>
                </form>
                <div className="bos-team-owner-note">
                  <strong>{data.unassigned ?? 0}</strong>
                  <span>位线索在待分配池</span>
                  {data.poolWait && (
                    <span>
                      本月已分配 {data.poolWait.assigned} 位，平均等待{" "}
                      {data.poolWait.averageMinutes === null ? "—" : `${data.poolWait.averageMinutes} 分钟`}
                    </span>
                  )}
                  <Link href="/customers?assign=pending" className="bos-text-link">
                    前往分配
                  </Link>
                </div>
                <div className="bos-team-assign-mode">
                <h2>新线索分配方式</h2>
                <form
                  className="bos-team-policy"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void save("settings/lead-assignment", "PUT", { mode: f.get("mode") }, "新线索分配方式已更新。");
                  }}
                >
                  <label>
                    Meta 表单、WhatsApp 入站、线索接口与未指定负责人的导入
                    <select name="mode" aria-label="新线索分配方式" defaultValue={data.leadAssignMode} key={data.leadAssignMode}>
                      <option value="POOL">进入待分配池，由管理员分配</option>
                      <option value="ROUND_ROBIN">按顺序轮流分给启用的销售</option>
                    </select>
                  </label>
                  <Button type="submit" disabled={busy}>
                    保存
                  </Button>
                </form>
                <p className="bos-footnote">轮流分配按「最近一次被分配的时间」排序，最久未分配的销售优先；停用的销售不参与。</p>
                </div>
              </Card>
            )}
            {admin && data.handover.length > 0 && (
              <Card>
                <h2>停用账号的客户待交接</h2>
                <p className="bos-footnote">停用不会自动转移客户。按负责人筛选后勾选客户，用「分配 / 转交」交给其他人。</p>
                <div className="bos-team-pending">
                  {data.handover.map((row) => (
                    <Link href={`/customers?owner=${encodeURIComponent(row.id)}`} key={row.id}>
                      <div>
                        <strong>{row.name}</strong>
                        <small>{row.customers} 位客户</small>
                      </div>
                      <Badge tone="warning">去交接</Badge>
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
      {admin && tab === "accounts" && (
        <Card>
          <div className="bos-team-heading">
            <div>
              <h2>账号管理</h2>
              <p>停用和重置密码会让已有登录失效。停用不会自动转移客户，请在客户管理中交接。自己的密码请在左下角「修改密码」中修改。</p>
            </div>
          </div>
          {accounts.length ? (
            <Table caption="账号管理" headings={["姓名", "登录邮箱", "角色", "状态", "负责客户", "操作"]}>
              {accounts.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    {row.self ? "（你）" : ""}
                  </td>
                  <td>{row.email}</td>
                  <td>{row.role === "ADMIN" ? "管理员" : "销售"}</td>
                  <td>
                    <Badge tone={row.isActive ? "green" : "warning"}>{row.isActive ? "使用中" : "已停用"}</Badge>
                  </td>
                  <td>
                    {row.customerCount}
                    {!row.isActive && row.customerCount > 0 && (
                      <Link className="bos-text-link" href={`/customers?owner=${encodeURIComponent(row.id)}`}>
                        {" "}
                        交接
                      </Link>
                    )}
                  </td>
                  <td>
                    <div className="bos-team-account-actions">
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setError("");
                          setEditor({ id: row.id, action: "name" });
                        }}
                      >
                        修改姓名
                      </Button>
                      <Button
                        disabled={busy || row.self}
                        onClick={() => {
                          setError("");
                          setEditor({ id: row.id, action: "password" });
                        }}
                      >
                        重置密码
                      </Button>
                      <Button
                        disabled={busy || row.self}
                        onClick={() => {
                          setError("");
                          setEditor({ id: row.id, action: "status" });
                        }}
                      >
                        {row.isActive ? "停用" : "启用"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="添加第一位销售" description="每位销售使用独立账号，仅能访问自己负责的客户、沟通和任务。" />
          )}
        </Card>
      )}
      {goal && (
        <Dialog open className="bos bos-team-dialog" title={`设置 ${goal.name} 的月度目标`} onClose={() => !busy && setTargetId(undefined)}>
          <form
            className="bos-team-editor"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void save(
                "sales-team/targets",
                "PUT",
                {
                  userId: goal.id,
                  month: data.month,
                  currency: data.currency,
                  targetRevenue: Number(f.get("amount")),
                  updatedAt: goal.target?.updatedAt || null,
                },
                "销售目标已保存。",
              );
            }}
          >
            <p>
              {data.month} · {data.currency}
            </p>
            <label>
              目标成交额
              <Input
                name="amount"
                type="number"
                min="0"
                max="999999999999.99"
                step="0.01"
                defaultValue={goal.target?.amount || ""}
                required
              />
            </label>
            {error && (
              <p role="alert" className="bos-sales-error">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "保存中…" : "保存目标"}
            </Button>
          </form>
        </Dialog>
      )}
      {editor && (
        <Dialog
          open
          className="bos bos-team-dialog"
          title={
            editor.action === "create"
              ? "添加账号"
              : editor.action === "password"
                ? `重置 ${account?.name} 的密码`
                : editor.action === "name"
                  ? "修改姓名"
                  : `${account?.isActive ? "停用" : "启用"} ${account?.name}`
          }
          onClose={() => !busy && setEditor(undefined)}
        >
          <form
            className="bos-team-editor"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (editor.action === "create")
                void save(
                  "sales-team/accounts",
                  "POST",
                  { name: f.get("name"), email: f.get("email"), password: f.get("password"), role: f.get("role") },
                  f.get("role") === "ADMIN" ? "管理员账号已创建。" : "销售账号已创建。",
                );
              else if (account)
                void save(
                  `sales-team/accounts/${account.id}`,
                  "PATCH",
                  {
                    action: editor.action,
                    sessionVersion: account.sessionVersion,
                    ...(editor.action === "password"
                      ? { password: f.get("password") }
                      : editor.action === "name"
                        ? { name: f.get("name") }
                        : { isActive: !account.isActive }),
                  },
                  editor.action === "password" ? "密码已重置，旧登录已失效。" : "销售账号已更新。",
                );
            }}
          >
            {(editor.action === "create" || editor.action === "name") && (
              <label>
                姓名
                <Input name="name" maxLength={100} defaultValue={account?.name || ""} required autoComplete="off" />
              </label>
            )}
            {editor.action === "create" && (
              <label>
                角色
                <select name="role" defaultValue="SALES" className="bos-input">
                  <option value="SALES">销售（只看自己的客户）</option>
                  <option value="ADMIN">管理员（管理全部客户与设置）</option>
                </select>
              </label>
            )}
            {editor.action === "create" && (
              <label>
                登录邮箱
                <Input name="email" type="email" maxLength={191} required autoComplete="off" />
              </label>
            )}
            {(editor.action === "create" || editor.action === "password") && (
              <label>
                {editor.action === "create" ? "初始密码" : "新密码"}
                <Input name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required />
              </label>
            )}
            {editor.action === "status" && (
              <p>
                {account?.isActive
                  ? `停用后该账号将无法登录，已有登录立即失效。其 ${account.customerCount} 位客户会保留，停用后可在「停用账号的客户待交接」中一键筛选并转交。`
                  : "启用后销售可以使用现有密码重新登录。"}
              </p>
            )}
            {editor.action === "password" && (
              <p className="bos-footnote">重置会让该销售所有已有登录失效。请通过你自己的渠道告知销售新密码。</p>
            )}
            {error && (
              <p role="alert" className="bos-sales-error">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "保存中…" : editor.action === "status" ? "确认更新" : "保存"}
            </Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
