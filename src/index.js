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

    // -------------------------
    // STATE (useState)
    // -------------------------
    useState(initial) {
        const i = this._stateIndex++;

        if (this._states[i] === undefined) {
            this._states[i] = initial;
        }

        const setState = (value) => {
            const next =
                typeof value === 'function'
                    ? value(this._states[i])
                    : value;

            if (!Object.is(this._states[i], next)) {
                this._states[i] = next;
            }
        };

        return [this._states[i], setState];
    }

    // -------------------------
    // EVENT HANDLERS
    // -------------------------
    useEvent(name, fn) {
        this._handlers[name] = fn;
    }

    mount(el) {
        this._root = el;

        this._root.addEventListener('click', (e) => {
            const target = e.target.closest('[data-click]');
            if (!target) return;

            const action = target.dataset.click;
            const handler = this._handlers[action];

            if (handler) {
                handler(e);
            }
        });

        return this;
    }

    // -------------------------
    // EFFECT SYSTEM
    // -------------------------
    run(fps = 1000 / 30) {
        if (this._interval) return;

        this._interval = setInterval(() => {
            if (this._spinlock) return;
            this._spinlock = true;

            // reset hook cursors each frame
            this._effectIndex = 0;
            this._stateIndex = 0;

            const react = (effect, deps) => {
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
            const view = this.main(react, this);

            // render commit phase
            if (this._root && typeof view === 'string') {
                if (view !== this._prevView) {
                    this._root.innerHTML = view;
                    this._prevView = view;
                }
            }

            this._spinlock = false;
        }, fps);
    }

    stop() {
        clearInterval(this._interval);
        this._interval = null;

        // cleanup all effects
        this._cleanups.forEach(fn => fn && fn());
    }
}














export default Ntred;

