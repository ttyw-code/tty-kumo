export class CancellationToken {
  private _isRequested = false;
  private _listeners: (() => void)[] = [];

  get isCancellationRequested() { return this._isRequested; }

  onCancellationRequested(listener: () => void) {
    if (this._isRequested) {
      try { listener(); } catch (e) { /* ignore */ }
      return { dispose: () => { } };
    }
    this._listeners.push(listener);
    return { dispose: () => { const i = this._listeners.indexOf(listener); if (i >= 0) this._listeners.splice(i, 1); } };
  }

  cancel() {
    if (!this._isRequested) {
      this._isRequested = true;
      for (const l of this._listeners.slice()) {
        try { l(); } catch (e) { /* ignore */ }
      }
    }
  }
}

export class CancellationTokenSource {
  private _token = new CancellationToken();
  get token() { return this._token; }
  cancel() { this._token.cancel(); }
}

export default CancellationToken;
