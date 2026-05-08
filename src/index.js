class Ntred {
    constructor(main) {
        this.main = main;

        // -------------------------
        // RENDER STATE
        // -------------------------
        this._root = null;
        this._prevView = '';

        // -------------------------
        // SCHEDULER STATE
        // -------------------------

        /**
         * True while a render pass is executing.
         * Prevents reentrant rendering.
         */
        this._rendering = false;

        /**
         * True if a RAF callback has already been scheduled.
         * Prevents duplicate RAF enqueueing.
         */
        this._scheduled = false;

        /**
         * True if another render is needed.
         * This flag is NEVER cleared accidentally.
         */
        this._needsRender = false;

        /**
         * Stops future work after stop()
         */
        this._stopped = false;

        // -------------------------
        // EFFECT SYSTEM
        // -------------------------

        /**
         * Stores previous dependency arrays.
         */
        this._effects = [];

        /**
         * Stores cleanup functions.
         */
        this._cleanups = [];

        /**
         * Effects collected during current render.
         * Flushed AFTER commit phase.
         */
        this._pendingEffects = [];

        this._effectIndex = 0;

        // -------------------------
        // STATE SYSTEM
        // -------------------------

        this._states = [];
        this._stateIndex = 0;

        // -------------------------
        // EVENTS
        // -------------------------

        /**
         * Always replaced every render.
         * Prevents stale closures.
         */
        this._handlers = {};
    }

    static create(main) {
        return new Ntred(main);
    }

    // =========================================================
    // STATE
    // =========================================================

    useState(initial) {
        const i = this._stateIndex++;

        if (this._states[i] === undefined) {
            this._states[i] =
                typeof initial === 'function'
                    ? initial()
                    : initial;
        }

        const setState = (value) => {
            const next =
                typeof value === 'function'
                    ? value(this._states[i])
                    : value;

            if (!Object.is(this._states[i], next)) {
                this._states[i] = next;

                // CHANGED:
                // Never render immediately.
                // Always schedule safely.
                this.scheduleUpdate();
            }
        };

        return [this._states[i], setState];
    }

    // =========================================================
    // EVENTS
    // =========================================================

    useEvent(name, fn) {
        // CHANGED:
        // Always replace handler every render.
        // Prevents stale closure bugs.
        this._handlers[name] = fn;
    }

    async ping(name, params = {}) {
        if (this._stopped) return;

        const handler = this._handlers[name];
        if (!handler) return;

        // CHANGED:
        // Wait until render fully completes.
        // Uses microtask yielding instead of RAF.
        while (this._rendering && !this._stopped) {
            await Promise.resolve();
        }

        handler(params);

        this.scheduleUpdate();
    }

    // =========================================================
    // SCHEDULER
    // =========================================================

    scheduleUpdate() {
        if (this._stopped) return;

        // CHANGED:
        // Mark render required.
        // This cannot be lost.
        this._needsRender = true;

        // Already scheduled -> do nothing
        if (this._scheduled) return;

        this._scheduled = true;

        requestAnimationFrame(() => {
            this._scheduled = false;

            // App stopped while waiting
            if (this._stopped) return;

            // Nothing needed
            if (!this._needsRender) return;

            // Consume render request
            this._needsRender = false;

            this.atomicRerenderAttempt();

            // CHANGED:
            // If state changed DURING render/effects,
            // schedule another frame safely.
            if (this._needsRender) {
                this.scheduleUpdate();
            }
        });
    }

    // =========================================================
    // MOUNTING
    // =========================================================

    mount(el) {
        this._root = el;

        // CHANGED:
        // Unified delegated event handling.
        this._root.addEventListener('click', (e) => {
            const target = e.target.closest('[data-click]');
            if (!target) return;

            const action = target.dataset.click;

            if (!action || action === 'none') return;

            const handler = this._handlers[action];

            if (!handler) return;

            handler(e);

            this.scheduleUpdate();
        });

        return this;
    }

    listen(evname, el) {
        if (!el) return this;

        el.addEventListener(evname, (e) => {
            const target = e.target.closest('[data-click]');

            if (!target) return;

            const action = target.dataset.click;

            if (!action || action === 'none') return;

            const handler = this._handlers[action];

            if (!handler) return;

            handler(e);

            this.scheduleUpdate();
        });

        return this;
    }

    // =========================================================
    // EFFECTS
    // =========================================================

    _registerEffect(effect, deps) {
        const i = this._effectIndex++;

        const prev = this._effects[i];

        const changed =
            !prev ||
            deps.length !== prev.length ||
            deps.some((d, j) => !Object.is(d, prev[j]));

        if (!changed) return;

        // CHANGED:
        // DO NOT run effects during render.
        // Queue them for post-commit execution.
        this._pendingEffects.push(() => {

            // Cleanup previous effect first
            if (this._cleanups[i]) {
                try {
                    this._cleanups[i]();
                } catch (err) {
                    console.error('Effect cleanup failed:', err);
                }
            }

            let cleanup = null;

            try {
                cleanup = effect();
            } catch (err) {
                console.error('Effect failed:', err);
            }

            this._effects[i] = deps;

            this._cleanups[i] =
                typeof cleanup === 'function'
                    ? cleanup
                    : null;
        });
    }

    _flushEffects() {
        const pending = this._pendingEffects;
        this._pendingEffects = [];

        for (const effect of pending) {
            effect();
        }
    }

    // =========================================================
    // RENDERING
    // =========================================================

    atomicRerenderAttempt() {
        // CHANGED:
        // Hard reentrancy protection.
        if (this._rendering) return;

        this._rendering = true;

        try {

            // Reset hook cursors
            this._effectIndex = 0;
            this._stateIndex = 0;

            // CHANGED:
            // Handlers recreated every render
            // to avoid stale closure issues.
            this._handlers = {};

            // Render app
            const view = this.main(
                this._registerEffect.bind(this),
                this
            );

            // -------------------------
            // COMMIT PHASE
            // -------------------------

            if (this._root && typeof view === 'string') {
                if (view !== this._prevView) {
                    this._root.innerHTML = view;
                    this._prevView = view;
                }
            }

            // Optional imperative render callback
            if (typeof view === 'function') {
                view();
            }

        } catch (err) {

            // CHANGED:
            // Prevent permanent deadlock.
            console.error('Render failed:', err);

        } finally {

            // CHANGED:
            // Lock ALWAYS released safely.
            this._rendering = false;
        }

        // -------------------------
        // EFFECT PHASE
        // -------------------------

        // CHANGED:
        // Effects run AFTER commit.
        this._flushEffects();
    }

    // =========================================================
    // LIFECYCLE
    // =========================================================

    run() {
        if (this._stopped === false && this._scheduled) {
            return;
        }

        this._stopped = false;

        this.scheduleUpdate();

        return this;
    }

    stop() {
        this._stopped = true;

        // Prevent future scheduled work
        this._scheduled = false;
        this._needsRender = false;

        // Cleanup effects safely
        for (const fn of this._cleanups) {
            if (!fn) continue;

            try {
                fn();
            } catch (err) {
                console.error('Cleanup failed:', err);
            }
        }

        return this;
    }
}

export default Ntred;
