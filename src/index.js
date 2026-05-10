/**
 * Ntred: A Reactive, Immediate-Mode UI Library
 * Version: 2.0 (Atomic Queue Edition)
 */
class Ntred {
    constructor(main) {
        this.main = main;

        // --- RENDER & DOM ---
        this._root = null;
        this._prevView = '';

        // --- SCHEDULER & LOCKS ---
        this._rendering = false;
        this._scheduled = false;
        this._needsRender = false;
        this._stopped = false;

        // --- ATOMIC QUEUES ---
        this._pingQueue = [];      // External pings
        this._pendingEffects = [];   // Post-commit work

        // --- PERMANENT HOOK STORAGE ---
        this._effects = [];
        this._cleanups = [];
        this._states = [];
        this._handlers = {};

        // --- ITERATION CURSORS ---
        this._effectIndex = 0;
        this._stateIndex = 0;
    }

    static create(main) {
        return new Ntred(main);
    }

    // =========================================================
    // STATE SYSTEM (useState)
    // =========================================================
    useState(initial) {
        const i = this._stateIndex++;

        if (this._states[i] === undefined) {
            this._states[i] = typeof initial === 'function' ? initial() : initial;
        }

        const setState = (value) => {
            const next = typeof value === 'function' ? value(this._states[i]) : value;

            if (!Object.is(this._states[i], next)) {
                this._states[i] = next;
                this.scheduleUpdate();
            }
        };

        return [this._states[i], setState];
    }

    // =========================================================
    // EVENT SYSTEM (useEvent & Ping)
    // =========================================================
    useEvent(name, fn) {
        // Updated every render to keep closures fresh
        this._handlers[name] = fn;
    }

    /**
     * Queues an intent from the outside world (e.g., Web Components, Timers).
     * Consumed atomically by the render loop.
     */
    ping(name, params = {}) {
        if (this._stopped) return;
        this._pingQueue.push({ name, params });
        this.scheduleUpdate();
    }

    // =========================================================
    // SCHEDULER
    // =========================================================
    scheduleUpdate() {
        if (this._stopped) return;
        this._needsRender = true;

        if (this._scheduled) return;
        this._scheduled = true;

        requestAnimationFrame(() => {
            this._scheduled = false;
            if (this._stopped || !this._needsRender) return;
            this.atomicRerenderAttempt();
        });
    }

    // =========================================================
    // THE RENDER LOOP (The Core Engine)
    // =========================================================
    atomicRerenderAttempt() {
        if (this._rendering) return;
        this._rendering = true;
        this._needsRender = false;

        try {
            // 1. CONSUME PING: Process ONE message per pass.
            if (this._pingQueue.length > 0) {
                const { name, params } = this._pingQueue.shift();
                const handler = this._handlers[name];
                if (handler) handler(params);

                // If more remain, keep the chain alive
                if (this._pingQueue.length > 0) this._needsRender = true;
            }

            // 2. PRE-RENDER: Reset cursors
            this._effectIndex = 0;
            this._stateIndex = 0;

            // 3. EXECUTE: Run main logic
            const view = this.main(this._registerEffect.bind(this), this);

            // 4. COMMIT: Update DOM
            if (this._root && typeof view === 'string') {
                if (view !== this._prevView) {
                    // Note: Ideally swap this with Morphdom/Idiomorph for node reuse
                    this._root.innerHTML = view;
                    this._prevView = view;
                }
            }
            if (typeof view === 'function') view();

        } catch (err) {
            console.error('Render Cycle Failed:', err);
        } finally {
            this._rendering = false;
        }

        // 5. POST-COMMIT: Flush queued effects
        this._flushEffects();

        // 6. RECURSION CHECK: If a handler/effect requested more work
        if (this._needsRender) this.scheduleUpdate();
    }

    // =========================================================
    // EFFECT SYSTEM
    // =========================================================
    _registerEffect(effect, deps) {
        const i = this._effectIndex++;
        const prev = this._effects[i];
        const changed = !prev || deps.some((d, j) => !Object.is(d, prev[j]));

        if (changed) {
            this._pendingEffects.push({ i, effect, deps });
        }
    }

    _flushEffects() {
        const queue = this._pendingEffects;
        this._pendingEffects = [];

        for (const { i, effect, deps } of queue) {
            // Cleanup stale effect
            if (this._cleanups[i]) {
                try { this._cleanups[i](); } catch (e) { console.error(e); }
            }
            // Run fresh effect
            const cleanup = effect();
            this._effects[i] = deps;
            this._cleanups[i] = typeof cleanup === 'function' ? cleanup : null;
        }
    }

    // =========================================================
    // MOUNTING & DELEGATION
    // =========================================================
    mount(el) {
        this._root = el;
        this._root.addEventListener('click', (e) => {
            const target = e.target.closest('[data-click]');
            if (!target || target.dataset.click === 'none') return;

            const handler = this._handlers[target.dataset.click];
            if (handler) {
                handler(e);
                this.scheduleUpdate();
            }
        });
        return this;
    }

    // Listens for custom events (e.g. from Web Components)
    listen(evname, el = this._root) {
        if (!el) return this;
        el.addEventListener(evname, (e) => {
            const target = e.target.closest(`[data-${evname}]`);
            if (!target) return;
            const action = target.getAttribute(`data-${evname}`);
            const handler = this._handlers[action];
            if (handler) {
                handler(e);
                this.scheduleUpdate();
            }
        });
        return this;
    }

    run() {
        this._stopped = false;
        this.scheduleUpdate();
        return this;
    }

    stop() {
        this._stopped = true;
        this._cleanups.forEach(fn => fn && fn());
        return this;
    }
}

export default Ntred;
