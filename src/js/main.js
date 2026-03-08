class DateTime extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._interval = null;
    }

    static get observedAttributes() {
        return ['format', 'live'];
    }

    connectedCallback() {
        this._render();
        if (this.live) {
            this._interval = setInterval(() => this._update(), 1000);
        }
    }

    disconnectedCallback() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }

    attributeChangedCallback() {
        this._render();
    }

    get live() {
        return this.hasAttribute('live');
    }

    get format() {
        return this.getAttribute('format') || 'datetime';
    }

    _formatDate(date) {
        const pad = (n) => String(n).padStart(2, '0');
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());

        switch (this.format) {
            case 'date':
                return `${year}-${month}-${day}`;
            case 'time':
                return `${hours}:${minutes}:${seconds}`;
            default:
                return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        }
    }

    _update() {
        const span = this.shadowRoot.querySelector('span');
        if (span) {
            span.textContent = this._formatDate(new Date());
        }
    }

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline;
                    font-family: monospace;
                    color: inherit;
                }
            </style>
            <span>${this._formatDate(new Date())}</span>
        `;
    }
}

customElements.define('date-time', DateTime);
