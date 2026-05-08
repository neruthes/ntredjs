class Ntred {
    constructor(main) {
        this.main = main;

        // render
        this._root = null;
        this._prevView = '';

        // loop control
        this._interval = null;
        this._spinlock = false;

        // effects (React-like)
        this._effects = [];
        this._cleanups = [];
        this._effectIndex = 0;

        // state (hook-like)
        this._states = [];
        this._stateIndex = 0;

        // event delegation
        this._handlers = {};
    }

    static create(main) {
        return new Ntred(main);
    }


    /**
     * Delivers a named event to the app. 
     * Guarantees safety by yielding if a rerender is in progress.
     */
    async ping(name, params = {}) {
        const handler = this._handlers[name];
        if (!handler) return;

        // If the spinlock is active, we yield the event loop and try again.
        // This prevents logic from running mid-render.
        while (this._spinlock) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        // Now that the lock is released, we can safely execute.
        handler(params);
        this.scheduleUpdate();
    }




    // -------------------------
    // STATE (useState)
    // -------------------------
    useState(initial) {
        const i = this._stateIndex++;

        if (this._states[i] === undefined) {
            this._states[i] = typeof initial === 'function' ? initial() : initial;
        }

        const setState = (value) => {
            const next =
                typeof value === 'function'
                    ? value(this._states[i])
                    : value;

            if (!Object.is(this._states[i], next)) {
                this._states[i] = next;
                this.scheduleUpdate();
            }
        };

        return [this._states[i], setState];
    }

    // -------------------------
    // EVENT HANDLERS
    // -------------------------
    useEvent(name, fn) {
        if (!this._handlers[name]) {
            this._handlers[name] = fn;
        }
    }


    scheduleUpdate() {
        if (this._dirty) return; // Already scheduled
        this._dirty = true;

        requestAnimationFrame(() => {
            this.atomicRerenderAttempt();
            this._dirty = false;

            // If something made it dirty DURING the render (like an effect),
            // schedule another update for the next frame.
            if (this._dirty) {
                this._dirty = false;
                this.scheduleUpdate();
            }
        });
    }

    mount(el) {
        this._root = el;
        // Wrapping event listener to trigger re-render
        this._root.addEventListener('click', (e) => {
            const target = e.target.closest('[data-click]');
            if (!target) return;
            const handler = this._handlers[target.dataset.click];
            if (handler) {
                handler(e);
                this.scheduleUpdate(); // Ensure click-driven state changes are caught
            }
        });
        return this;
    }


    listen(evname, el) {
        if (!el) return this;

        // TODO: Really customize handling depending on evname
        el.addEventListener(evname, (e) => {
            // Find the closest ancestor with a data-click attribute
            const target = e.target.closest('[data-click]');

            // If no data-click attribute or if the action is explicitly 'none', ignore
            if (!target || target.dataset.click === 'none') return;

            const action = target.dataset.click;
            const handler = this._handlers[action];

            if (handler) {
                // If the action is found in this component's handlers, execute it
                handler(e);
                this.scheduleUpdate();
            }
        });

        return this; // Maintain chainability
    }

    // -------------------------
    // EFFECT SYSTEM
    // -------------------------
    atomicRerenderAttempt() {
        if (this._spinlock) return;
        this._spinlock = true;
        // console.log('atomicRerenderAttempt()');

        // reset hook cursors each frame
        this._effectIndex = 0;
        this._stateIndex = 0;

        const useEffect = (effect, deps) => {
            const i = this._effectIndex++;

            const prev = this._effects[i];

            const changed =
                !prev ||
                deps.length !== prev.length ||
                deps.some((d, j) => !Object.is(d, prev[j]));

            if (changed) {
                // cleanup previous effect
                if (this._cleanups[i]) {
                    this._cleanups[i]();
                }

                const cleanup = effect();

                this._effects[i] = deps;
                this._cleanups[i] =
                    typeof cleanup === 'function' ? cleanup : null;
            }
        };

        // run app
        const view = this.main(useEffect, this);

        // console.log('view');
        // console.log(view);
        // console.log('typeof view');
        // console.log(typeof view);

        // render commit phase
        if (this._root && typeof view === 'string') {
            if (view !== this._prevView) {
                this._root.innerHTML = view;
                this._prevView = view;
            }
        }
        if (typeof view === 'function') {
            view();
        }

        this._spinlock = false;
    }
    run() {
        if (this._interval) return;
        this.scheduleUpdate();
        this._interval = 10;
        // Nothing happens as we migrate from polling to reacting
    }

    stop() {
        clearInterval(this._interval);
        this._interval = null;

        // cleanup all effects
        this._cleanups.forEach(fn => fn && fn());
    }
}

export default Ntred;

