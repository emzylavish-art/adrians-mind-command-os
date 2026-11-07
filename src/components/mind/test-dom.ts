/**
 * Small DOM for node --test. One window.localStorage stays in place across
 * unmount and a fresh createRoot. This file does not import jsdom.
 */

type Listener = (event: DomEvent) => void;

type DomEvent = {
  type: string;
  target: DomNode | null;
  currentTarget: DomNode | null;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented: boolean;
  button: number;
  timeStamp: number;
  nativeEvent: DomEvent;
  preventDefault: () => void;
  stopPropagation: () => void;
  stopped: boolean;
};

class DomNode {
  nodeType = 0;
  nodeName = "";
  parentNode: DomNode | null = null;
  childNodes: DomNode[] = [];
  ownerDocument: DomDocument | null = null;
  nodeValue: string | null = null;
  listeners: { capture: Record<string, Listener[]>; bubble: Record<string, Listener[]> } = { capture: {}, bubble: {} };

  get firstChild(): DomNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): DomNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): DomNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] ?? null : null;
  }
  get previousSibling(): DomNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] ?? null : null;
  }
  get textContent(): string {
    return this.nodeValue ?? "";
  }
  set textContent(value: string) {
    this.nodeValue = value;
  }
  get isConnected(): boolean {
    let node: DomNode | null = this;
    while (node) {
      if (node.nodeType === 9) return true;
      node = node.parentNode;
    }
    return false;
  }
  appendChild<T extends DomNode>(child: T): T {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore<T extends DomNode>(child: T, before: DomNode | null): T {
    if (!before) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(before);
    if (index < 0) return this.appendChild(child);
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    return child;
  }
  removeChild<T extends DomNode>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error("The node is not a child.");
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  replaceChild<T extends DomNode>(next: DomNode, prev: T): T {
    const index = this.childNodes.indexOf(prev);
    if (index < 0) throw new Error("The node is not a child.");
    if (next.parentNode) next.parentNode.removeChild(next);
    next.parentNode = this;
    this.childNodes[index] = next;
    prev.parentNode = null;
    return prev;
  }
  contains(node: DomNode | null): boolean {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
  addEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void {
    const capture = options === true || (typeof options === "object" && options?.capture === true);
    const bag = capture ? this.listeners.capture : this.listeners.bubble;
    const list = bag[type] ?? [];
    list.push(listener);
    bag[type] = list;
  }
  removeEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void {
    const capture = options === true || (typeof options === "object" && options?.capture === true);
    const bag = capture ? this.listeners.capture : this.listeners.bubble;
    bag[type] = (bag[type] ?? []).filter((item) => item !== listener);
  }
  dispatchEvent(event: DomEvent): boolean {
    const path: DomNode[] = [];
    let node: DomNode | null = event.target;
    while (node) {
      path.push(node);
      node = node.parentNode;
    }
    for (let index = path.length - 1; index >= 0 && !event.stopped; index -= 1) {
      event.currentTarget = path[index] ?? null;
      for (const listener of path[index]?.listeners.capture[event.type] ?? []) listener(event);
    }
    for (let index = 0; index < path.length && !event.stopped; index += 1) {
      event.currentTarget = path[index] ?? null;
      for (const listener of path[index]?.listeners.bubble[event.type] ?? []) listener(event);
    }
    return !event.defaultPrevented;
  }
  click(): void {
    this.dispatchEvent(createEvent("click", this));
  }
}

class DomText extends DomNode {
  constructor(value: string) {
    super();
    this.nodeType = 3;
    this.nodeName = "#text";
    this.nodeValue = value;
  }
}

class DomElement extends DomNode {
  tagName: string;
  attributes: Record<string, string> = {};
  style: { setProperty: (name: string, value: string) => void; [key: string]: unknown };
  className = "";
  id = "";
  disabled = false;
  value = "";
  constructor(tag: string) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.nodeName = this.tagName;
    const style: { setProperty: (name: string, value: string) => void; [key: string]: unknown } = {
      setProperty(name: string, value: string) {
        style[name] = value;
      },
    };
    this.style = style;
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(new DomText(value));
  }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
    if (name === "disabled") this.disabled = true;
  }
  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] ?? null : null;
  }
  removeAttribute(name: string): void {
    delete this.attributes[name];
  }
  hasAttribute(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }
  matches(selector: string): boolean {
    const attr = selector.match(/^\[([^=\]]+)=["']?([^"'\]]+)["']?\]$/);
    if (attr) return this.getAttribute(attr[1] ?? "") === attr[2];
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelector(selector: string): DomElement | null {
    for (const child of this.childNodes) {
      if (child instanceof DomElement) {
        if (child.matches(selector)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
    }
    return null;
  }
  get children(): DomElement[] {
    return this.childNodes.filter((child): child is DomElement => child instanceof DomElement);
  }
  focus(): void {
    this.ownerDocument && (this.ownerDocument.activeElement = this);
  }
  blur(): void {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null;
  }
}

class DomDocument extends DomNode {
  documentElement: DomElement;
  body: DomElement;
  head: DomElement;
  activeElement: DomElement | null = null;
  defaultView: DomWindow;
  constructor(view: DomWindow) {
    super();
    this.nodeType = 9;
    this.nodeName = "#document";
    this.defaultView = view;
    this.documentElement = new DomElement("html");
    this.head = new DomElement("head");
    this.body = new DomElement("body");
    this.documentElement.ownerDocument = this;
    this.head.ownerDocument = this;
    this.body.ownerDocument = this;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string): DomElement {
    const element = new DomElement(tag);
    element.ownerDocument = this;
    return element;
  }
  createElementNS(_namespace: string, tag: string): DomElement {
    return this.createElement(tag);
  }
  createTextNode(value: string): DomText {
    const text = new DomText(value);
    text.ownerDocument = this;
    return text;
  }
  createComment(value: string): DomText {
    const comment = new DomText(value);
    comment.nodeType = 8;
    comment.nodeName = "#comment";
    comment.ownerDocument = this;
    return comment;
  }
  createDocumentFragment(): DomElement {
    const fragment = new DomElement("#fragment");
    fragment.nodeType = 11;
    fragment.ownerDocument = this;
    return fragment;
  }
  getElementById(id: string): DomElement | null {
    return this.querySelector(`#${id}`);
  }
  querySelector(selector: string): DomElement | null {
    return this.documentElement.querySelector(selector) ?? (this.documentElement.matches(selector) ? this.documentElement : null);
  }
  addEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void {
    this.documentElement.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void {
    this.documentElement.removeEventListener(type, listener, options);
  }
}

class StorageBox {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  getItem(key: string): string | null {
    return this.items.has(key) ? this.items.get(key) ?? null : null;
  }
  setItem(key: string, value: string): void {
    this.items.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.items.delete(String(key));
  }
  clear(): void {
    this.items.clear();
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
}

class DomWindow {
  document: DomDocument;
  localStorage: StorageBox;
  sessionStorage: StorageBox;
  navigator = { userAgent: "node-test-dom" };
  location = { hostname: "localhost", pathname: "/", href: "http://localhost/" };
  HTMLElement: typeof DomElement;
  Element: typeof DomElement;
  Node: typeof DomNode;
  constructor() {
    this.HTMLElement = DomElement;
    this.Element = DomElement;
    this.Node = DomNode;
    this.document = new DomDocument(this);
    this.localStorage = new StorageBox();
    this.sessionStorage = new StorageBox();
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  getComputedStyle(): { getPropertyValue: () => string } {
    return { getPropertyValue: () => "" };
  }
  requestAnimationFrame(callback: (time: number) => void): number {
    callback(0);
    return 1;
  }
  cancelAnimationFrame(): void {}
}

function createEvent(type: string, target: DomNode): DomEvent {
  const event = {
    type,
    target,
    currentTarget: null as DomNode | null,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    button: 0,
    timeStamp: Date.now(),
    stopped: false,
    nativeEvent: null as unknown as DomEvent,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.stopped = true;
    },
  };
  event.nativeEvent = event;
  return event;
}

let installed = false;

/** Install one document and localStorage on the global object. Later calls keep the same storage. */
export function installTestDom(): { window: DomWindow; document: DomDocument } {
  if (installed && globalThis.document && globalThis.localStorage) {
    return { window: globalThis.window as DomWindow, document: globalThis.document as DomDocument };
  }
  const view = new DomWindow();
  const assigned = {
    window: view,
    document: view.document,
    localStorage: view.localStorage,
    sessionStorage: view.sessionStorage,
    HTMLElement: view.HTMLElement,
    Element: view.Element,
    Node: view.Node,
    navigator: view.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  Object.assign(globalThis, assigned);
  installed = true;
  return { window: view, document: view.document };
}
