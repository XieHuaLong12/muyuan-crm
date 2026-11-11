/**
 * Data for LazyForEach: only the rows on screen (plus List.cachedCount) are built, so long lists scroll smoothly.
 * reset() starts a new generation: screens put `generation` in the row key, so every row is rebuilt with the new
 * data even when its id did not change; append() keeps the rows already built (load more).
 */
export class ListSource<T> implements IDataSource {
  private items: T[] = [];
  private listeners: DataChangeListener[] = [];
  generation: number = 0;

  totalCount(): number {
    return this.items.length;
  }

  getData(index: number): T {
    return this.items[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) {
      this.listeners.push(listener);
    }
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  all(): T[] {
    return this.items;
  }

  reset(items: T[]): void {
    this.generation++;
    this.items = items;
    this.notify();
  }

  append(items: T[]): void {
    this.items = this.items.concat(items);
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener: DataChangeListener) => {
      listener.onDataReloaded();
    });
  }
}
