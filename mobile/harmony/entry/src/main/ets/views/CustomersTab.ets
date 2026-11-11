import { RouteParam, Routes } from '../common/Config';
import { Fmt } from '../common/Format';
import { SOURCES, STAGES, label, stageTone } from '../common/Labels';
import { Api } from '../api/Http';
import { Repo } from '../api/Repo';
import { Session } from '../api/Session';
import { CustomerListPage, ListCustomerRow, QueueCount, QueueCustomer, SalesQueue } from '../api/Models';
import { LvIcon } from '../components/LvIcon';
import { ListSource } from '../components/ListSource';
import { Avatar, Pill, StateView } from '../components/Ui';

class QueueDef {
  key: string;
  title: string;
  adminOnly: boolean;

  constructor(key: string, title: string, adminOnly: boolean = false) {
    this.key = key;
    this.title = title;
    this.adminOnly = adminOnly;
  }
}

/** One row of the list, whichever endpoint it came from. */
class CustomerItem {
  id: string = '';
  name: string = '';
  company: string = '';
  country: string = '';
  stage: string = '';
  grade: string = '';
  note: string = '';
  dueText: string = '';
  dueLate: boolean = false;
  dueSoon: boolean = false;
  firstContact: boolean = false;
}

class Option {
  key: string;
  title: string;

  constructor(key: string, title: string) {
    this.key = key;
    this.title = title;
  }
}

const STAGE_KEYS: string[] = ['NEW', 'CONTACTED', 'REPLIED', 'CATALOG_SENT', 'NEEDS_CONFIRMED', 'PRODUCT_CONFIRMED', 'QUOTED', 'FOLLOW_UP',
  'ORDER', 'WON', 'PAUSED', 'LOST', 'INVALID'];
const SOURCE_KEYS: string[] = ['FACEBOOK', 'META_CLICK_TO_WHATSAPP', 'INSTAGRAM', 'TIKTOK', 'WHATSAPP', 'WEBSITE', 'ALIBABA', 'EXHIBITION',
  'REFERRAL', 'OUTBOUND', 'OTHER'];
const GRADES: Option[] = [new Option('A', 'A 级'), new Option('B', 'B 级'), new Option('C', 'C 级'), new Option('D', 'D 级'), new Option('none', '未评级')];
/** GET /api/customers sort keys (lib/customer-columns.ts) with the direction that reads naturally. */
const SORTS: Option[] = [
  new Option('priority', '智能排序'), new Option('nextFollowUpAt', '下次跟进最近'), new Option('inquiryAt', '最新进线'),
  new Option('lastWhatsAppAt', '最近 WhatsApp'), new Option('aiScore', 'AI 评分最高')
];

/** Queues defined once on the server (services/bos-sales-service.ts queueFilters); 待分配 is the assignment pool. */
const QUEUES: QueueDef[] = [
  new QueueDef('pool', '待分配', true),
  new QueueDef('today', '今日跟进'),
  new QueueDef('new', '待首联'),
  new QueueDef('waiting', '等我回复'),
  new QueueDef('high', '高意向'),
  new QueueDef('recent', '全部')
];

function fromQueue(c: QueueCustomer): CustomerItem {
  const item = new CustomerItem();
  item.id = c.id;
  item.name = c.name;
  item.company = c.companyName;
  item.country = c.country;
  item.stage = c.stage;
  item.grade = c.leadGrade;
  item.note = c.reasons.length > 0 ? c.reasons.join(' · ') : c.leadGradeReason;
  const pendingFirst = c.firstContactDueAt !== null && c.firstContactAt === null;
  const due = Fmt.due(pendingFirst ? c.firstContactDueAt : c.nextFollowUpAt);
  item.firstContact = pendingFirst;
  item.dueText = pendingFirst || c.nextFollowUpAt !== null ? due.text : '';
  item.dueLate = due.late;
  item.dueSoon = due.soon;
  return item;
}

function fromList(c: ListCustomerRow): CustomerItem {
  const item = new CustomerItem();
  item.id = c.id;
  item.name = c.name;
  item.company = c.companyName;
  item.country = c.country;
  item.stage = c.stage;
  item.grade = c.leadGrade;
  item.note = c.leadGradeReason.length > 0 ? c.leadGradeReason : `进线 ${Fmt.ago(c.inquiryAt !== null ? c.inquiryAt : c.createdAt)}`;
  return item;
}

@Component
export struct CustomersTab {
  @Consume('pathStack') pathStack: NavPathStack;
  @StorageLink('customersQueue') @Watch('onQueueRequested') requested: string = '';
  @State queue: string = Session.isAdmin() ? 'recent' : 'today';
  @State count: number = 0;
  private source: ListSource<CustomerItem> = new ListSource<CustomerItem>();
  @State counts: QueueCount[] = [];
  @State total: number = 0;
  @State page: number = 1;
  @State keyword: string = '';
  @State state: string = 'loading';
  @State error: string = '';
  @State refreshing: boolean = false;
  @State loadingMore: boolean = false;
  @State poolCount: number = 0;
  @StorageProp('dataChanged') @Watch('onDataChanged') dataChanged: number = 0;
  // 筛选与排序 (GET /api/customers): applied values, and the draft edited in the sheet.
  @State fStage: string = '';
  @State fSource: string = '';
  @State fGrade: string = '';
  @State fSort: string = 'priority';
  @State dStage: string = '';
  @State dSource: string = '';
  @State dGrade: string = '';
  @State dSort: string = 'priority';
  @State showFilter: boolean = false;
  private searchTimer: number = -1;

  /** A follow-up, stage or task changed somewhere: the queues may have moved. */
  onDataChanged(): void {
    this.load(true);
  }

  aboutToAppear(): void {
    if (this.requested.length > 0) {
      this.queue = this.requested;
      this.requested = '';
    }
    this.showCached();
    this.load(true);
  }

  /** The home tab asked for a queue (e.g. tapping 「待首联」). */
  onQueueRequested(): void {
    if (this.requested.length > 0) {
      this.queue = this.requested;
      this.requested = '';
      this.state = 'loading';
      this.showCached();
      this.load(true);
    }
  }

  private toast(message: string): void {
    this.getUIContext().getPromptAction().showToast({ message: message, duration: 2200 });
  }

  /** The last list of this queue, shown at once while the fresh one loads. */
  private showCached(): void {
    if (this.keyword.length > 0 || this.filtered()) {
      return;
    }
    if (this.queue === 'pool') {
      const pool = Repo.peekPool();
      if (pool !== null) {
        this.applyPool(pool);
        this.state = 'ready';
      }
    } else {
      const cached = Repo.peekQueue(this.queue);
      if (cached !== null) {
        this.applyQueue(cached, true);
        this.state = 'ready';
      }
    }
  }

  private applyPool(result: CustomerListPage): void {
    this.source.reset(result.rows.map(fromList));
    this.count = this.source.totalCount();
    this.total = result.total;
    this.poolCount = result.pool;
  }

  private applyQueue(result: SalesQueue, reset: boolean): void {
    const rows = result.customers.map(fromQueue);
    if (reset) {
      this.source.reset(rows);
    } else {
      this.source.append(rows);
    }
    this.count = this.source.totalCount();
    this.total = result.total;
    this.counts = result.counts;
  }

  private async load(reset: boolean): Promise<void> {
    const page = reset ? 1 : this.page + 1;
    const queue = this.queue;
    try {
      if (this.filtered()) {
        const result = await Repo.customers(this.filterQuery(), page);
        if (!this.filtered()) return;
        const rows = result.rows.map(fromList);
        if (reset) {
          this.source.reset(rows);
        } else {
          this.source.append(rows);
        }
        this.count = this.source.totalCount();
        this.total = result.total;
      } else if (queue === 'pool') {
        const result = await Repo.pool(this.keyword);
        if (queue !== this.queue) return;
        this.applyPool(result);
      } else {
        const result = await Repo.queue(queue, this.keyword, page);
        if (queue !== this.queue) return;
        this.applyQueue(result, reset);
      }
      this.page = page;
      this.state = 'ready';
    } catch (e) {
      this.error = Api.message(e);
      if (this.state !== 'ready') {
        this.state = 'error';
      } else if (reset) {
        this.toast(`没有连上服务器，显示的是上次的数据。${this.error}`);
      }
    } finally {
      this.refreshing = false;
      this.loadingMore = false;
    }
  }

  private countOf(key: string): number {
    if (key === 'pool') return this.poolCount;
    const found = this.counts.find((c: QueueCount): boolean => c.key === key);
    return found === undefined ? -1 : found.count;
  }

  private filtered(): boolean {
    return this.fStage.length > 0 || this.fSource.length > 0 || this.fGrade.length > 0 || this.fSort !== 'priority';
  }

  private filterQuery(): Record<string, string> {
    const query: Record<string, string> = {
      'group': 'all', 'q': this.keyword, 'stage': this.fStage, 'source': this.fSource, 'grade': this.fGrade, 'sort': this.fSort,
      'dir': this.fSort === 'priority' || this.fSort === 'nextFollowUpAt' ? 'asc' : 'desc'
    };
    return query;
  }

  private filterSummary(): string {
    const parts: string[] = [];
    if (this.fStage.length > 0) parts.push(label(STAGES, this.fStage));
    if (this.fSource.length > 0) parts.push(label(SOURCES, this.fSource));
    if (this.fGrade.length > 0) parts.push(this.fGrade === 'none' ? '未评级' : `${this.fGrade} 级`);
    const sort = SORTS.find((o: Option): boolean => o.key === this.fSort);
    if (this.fSort !== 'priority' && sort !== undefined) parts.push(sort.title);
    return parts.join(' · ');
  }

  private openFilter(): void {
    this.dStage = this.fStage;
    this.dSource = this.fSource;
    this.dGrade = this.fGrade;
    this.dSort = this.fSort;
    this.showFilter = true;
  }

  private applyFilter(): void {
    this.fStage = this.dStage;
    this.fSource = this.dSource;
    this.fGrade = this.dGrade;
    this.fSort = this.dSort;
    this.showFilter = false;
    this.state = 'loading';
    this.load(true);
  }

  private clearFilter(): void {
    this.fStage = '';
    this.fSource = '';
    this.fGrade = '';
    this.fSort = 'priority';
    this.state = 'loading';
    this.showCached();
    this.load(true);
  }

  private draftOf(which: string): string {
    if (which === 'stage') return this.dStage;
    if (which === 'source') return this.dSource;
    if (which === 'grade') return this.dGrade;
    return this.dSort;
  }

  private setDraft(which: string, key: string): void {
    const value = this.draftOf(which) === key && which !== 'sort' ? '' : key;
    if (which === 'stage') this.dStage = value;
    else if (which === 'source') this.dSource = value;
    else if (which === 'grade') this.dGrade = value;
    else this.dSort = value;
  }

  @Builder
  optionChips(which: string, options: Option[]) {
    Flex({ wrap: FlexWrap.Wrap }) {
      ForEach(options, (o: Option) => {
        Text(o.title)
          .fontSize(14)
          .fontColor(this.draftOf(which) === o.key ? $r('app.color.on_brand') : $r('app.color.ink2'))
          .backgroundColor(this.draftOf(which) === o.key ? $r('app.color.brand') : $r('app.color.surface2'))
          .borderRadius(17)
          .height(34)
          .padding({ left: 12, right: 12 })
          .margin({ right: 8, bottom: 8 })
          .onClick(() => this.setDraft(which, o.key))
      }, (o: Option): string => o.key)
    }
  }

  private stageOptions(): Option[] {
    return STAGE_KEYS.map((k: string): Option => new Option(k, label(STAGES, k)));
  }

  private sourceOptions(): Option[] {
    return SOURCE_KEYS.map((k: string): Option => new Option(k, label(SOURCES, k)));
  }

  @Builder
  filterSheet() {
    Column() {
      Scroll() {
        Column({ space: 12 }) {
          Text('筛选与排序').fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
          Text('排序').fontSize(14).fontColor($r('app.color.ink2'))
          this.optionChips('sort', SORTS)
          Text('阶段').fontSize(14).fontColor($r('app.color.ink2'))
          this.optionChips('stage', this.stageOptions())
          Text('等级').fontSize(14).fontColor($r('app.color.ink2'))
          this.optionChips('grade', GRADES)
          Text('来源').fontSize(14).fontColor($r('app.color.ink2'))
          this.optionChips('source', this.sourceOptions())
        }
        .alignItems(HorizontalAlign.Start)
        .padding({ left: 16, right: 16, top: 8, bottom: 16 })
      }
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
      .layoutWeight(1)
      Row({ space: 10 }) {
        Button('重置')
          .type(ButtonType.Normal).height(46).borderRadius(12).layoutWeight(1)
          .fontColor($r('app.color.ink')).backgroundColor($r('app.color.surface2'))
          .onClick(() => {
            this.dStage = '';
            this.dSource = '';
            this.dGrade = '';
            this.dSort = 'priority';
          })
        Button('查看结果')
          .type(ButtonType.Normal).height(46).borderRadius(12).layoutWeight(2)
          .fontColor($r('app.color.on_brand')).backgroundColor($r('app.color.brand'))
          .onClick(() => this.applyFilter())
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 16 })
    }
    .width('100%')
    .height('100%')
  }

  private select(key: string): void {
    if (key === this.queue && !this.filtered()) return;
    this.fStage = '';
    this.fSource = '';
    this.fGrade = '';
    this.fSort = 'priority';
    this.queue = key;
    this.state = 'loading';
    this.showCached();
    this.load(true);
  }

  private onSearch(value: string): void {
    this.keyword = value.trim();
    if (this.searchTimer !== -1) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.state = 'loading';
      this.load(true);
    }, 400);
  }

  private visibleQueues(): QueueDef[] {
    const admin = Session.isAdmin();
    return QUEUES.filter((q: QueueDef): boolean => admin || !q.adminOnly);
  }

  @Builder
  chip(q: QueueDef) {
    Row({ space: 6 }) {
      Text(q.title)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.queue === q.key && !this.filtered() ? $r('app.color.on_brand') : $r('app.color.ink2'))
      if (this.countOf(q.key) >= 0 && q.key !== 'recent') {
        Text(`${this.countOf(q.key)}`)
          .fontSize(12)
          .fontColor(this.queue === q.key ? $r('app.color.on_brand') : (q.key === 'new' || q.key === 'waiting' || q.key === 'pool') && this.countOf(q.key) > 0 ? $r('app.color.danger') : $r('app.color.ink3'))
      }
    }
    .height(36)
    .padding({ left: 14, right: 14 })
    .borderRadius(18)
    .backgroundColor(this.queue === q.key && !this.filtered() ? $r('app.color.brand') : $r('app.color.surface'))
    .border({ width: this.queue === q.key ? 0 : 1, color: $r('app.color.line') })
    .onClick(() => this.select(q.key))
  }

  @Builder
  card(item: CustomerItem) {
    Column({ space: 8 }) {
      Row({ space: 12 }) {
        Avatar({ name: item.name, grade: item.grade })
        Column({ space: 3 }) {
          Text(item.name).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(`${item.company.length > 0 ? `${item.company} · ` : ''}${item.country}`)
            .fontSize(13).fontColor($r('app.color.ink3')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Row({ space: 6 }) {
            Pill({ text: label(STAGES, item.stage), tone: stageTone(item.stage) })
          }
          .margin({ top: 2 })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        LvIcon({ name: 'chevron-right', iconColor: $r('app.color.ink3'), iconSize: 18 })
      }
      .width('100%')

      if (item.dueText.length > 0 || item.note.length > 0) {
        Row({ space: 10 }) {
          if (item.dueText.length > 0) {
            Row({ space: 4 }) {
              LvIcon({ name: item.firstContact ? 'timer' : 'alarm-clock', iconColor: item.dueLate ? $r('app.color.danger') : item.dueSoon ? $r('app.color.warning') : $r('app.color.ink3'), iconSize: 14 })
              Text(`${item.firstContact ? '首联 ' : ''}${item.dueText}`)
                .fontSize(12)
                .fontWeight(item.dueLate || item.dueSoon ? FontWeight.Medium : FontWeight.Normal)
                .fontColor(item.dueLate ? $r('app.color.danger') : item.dueSoon ? $r('app.color.warning') : $r('app.color.ink3'))
            }
          }
          if (item.note.length > 0) {
            Text(item.note).fontSize(12).fontColor($r('app.color.ink3')).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
          }
        }
        .width('100%')
        .padding({ top: 8 })
        .border({ width: { top: 0.5 }, color: $r('app.color.line_soft') })
      }
    }
    .padding(14)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(16)
    .border({ width: 0.5, color: $r('app.color.line_soft') })
    .onClick(() => {
      this.pathStack.pushPathByName(Routes.CUSTOMER, new RouteParam(item.id));
    })
  }

  build() {
    Column() {
      Column({ space: 10 }) {
        Row({ space: 8 }) {
          Column({ space: 2 }) {
            Text('客户').fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink'))
            Text(Session.isAdmin() ? '全公司客户 · 队列与电脑端「跟进队列」一致' : '我负责的客户').fontSize(13).fontColor($r('app.color.ink3'))
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Row() {
            LvIcon({ name: 'list-filter', iconColor: this.filtered() ? $r('app.color.on_brand') : $r('app.color.ink'), iconSize: 20 })
          }
          .width(40).height(40).borderRadius(20).justifyContent(FlexAlign.Center)
          .backgroundColor(this.filtered() ? $r('app.color.brand') : $r('app.color.surface'))
          .onClick(() => this.openFilter())
          Row() {
            LvIcon({ name: 'plus', iconColor: $r('app.color.on_brand'), iconSize: 22 })
          }
          .width(40).height(40).borderRadius(20).justifyContent(FlexAlign.Center)
          .backgroundColor($r('app.color.brand'))
          .onClick(() => {
            this.pathStack.pushPathByName(Routes.NEW_CUSTOMER, new RouteParam(''));
          })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 16 })

        Search({ value: this.keyword, placeholder: '姓名、公司、国家、WhatsApp' })
          .height(44)
          .margin({ left: 16, right: 16 })
          .backgroundColor($r('app.color.surface2'))
          .onChange((value: string): void => this.onSearch(value))

        Scroll() {
          Row({ space: 8 }) {
            ForEach(this.visibleQueues(), (q: QueueDef) => {
              this.chip(q)
            }, (q: QueueDef): string => q.key)
          }
          .padding({ left: 16, right: 16 })
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')

        if (this.filtered()) {
          Row({ space: 8 }) {
            LvIcon({ name: 'list-filter', iconColor: $r('app.color.brand_ink'), iconSize: 16 })
            Text(`筛选：${this.filterSummary()}`).fontSize(13).fontColor($r('app.color.brand_ink')).layoutWeight(1)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text('清除').fontSize(13).fontColor($r('app.color.ink2')).onClick(() => this.clearFilter())
          }
          .width('100%')
          .padding({ left: 28, right: 16 })
        }
      }
      .padding({ bottom: 10 })
      .bindSheet($$this.showFilter, this.filterSheet(), { detents: [SheetSize.LARGE], dragBar: true })
      .backgroundColor($r('app.color.bg'))

      if (this.state === 'loading') {
        StateView({ kind: 'loading' }).layoutWeight(1)
      } else if (this.state === 'error') {
        StateView({ kind: 'error', message: this.error, actionText: '重新加载', onAction: () => {
          this.state = 'loading';
          this.load(true);
        } }).layoutWeight(1)
      } else {
        Refresh({ refreshing: $$this.refreshing }) {
          List({ space: 10 }) {
            ListItem() {
              Text(`共 ${this.total} 位`).fontSize(12).fontColor($r('app.color.ink3')).padding({ left: 4 })
            }

            if (this.count === 0) {
              ListItem() {
                StateView({
                  kind: 'empty', icon: 'users',
                  title: this.keyword.length > 0 ? `没有找到「${this.keyword}」` : '这个队列里没有客户',
                  message: this.keyword.length > 0 ? '换个关键词，或切换到「全部」再搜索。' : '有新的待办时会出现在这里。'
                })
              }
            }

            LazyForEach(this.source, (item: CustomerItem) => {
              ListItem() {
                this.card(item)
              }
            }, (item: CustomerItem): string => `${this.source.generation}-${item.id}`)

            if ((this.filtered() || this.queue !== 'pool') && this.count < this.total) {
              ListItem() {
                Button(this.loadingMore ? '加载中' : '加载更多')
                  .type(ButtonType.Normal).borderRadius(12).height(44).width('100%')
                  .fontColor($r('app.color.brand_ink')).backgroundColor($r('app.color.surface'))
                  .enabled(!this.loadingMore)
                  .onClick(() => {
                    this.loadingMore = true;
                    this.load(false);
                  })
              }
            }
          }
          .cachedCount(5)
          .padding({ left: 16, right: 16, bottom: 24 })
          .scrollBar(BarState.Off)
          .height('100%')
        }
        .onRefreshing(() => {
          this.load(true);
        })
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
  }
}
