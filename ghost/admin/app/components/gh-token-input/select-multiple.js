import PowerSelectMultiple from 'ember-power-select/components/power-select-multiple';
import {action} from '@ember/object';
import {bind} from '@ember/runloop';
import {tagName} from '@ember-decorators/component';

// Native DOM equivalents of the previous jQuery `click.ghToken mouseup.ghToken
// touchend.ghToken` namespaced events. We keep a stable bound listener reference
// (this._allowFocusListener) so add/removeEventListener pair up correctly.
const END_EVENTS = ['click', 'mouseup', 'touchend'];

// triggering focus on the search input within ESA's onfocus event breaks the
// drag-n-drop functionality in ember-drag-drop so we watch for events that
// could be the start of a drag and disable the default focus behaviour until
// we get another event signalling the end of a drag

@tagName('div')
class GhTokenInputSelectMultiple extends PowerSelectMultiple {
    _canFocus = true;

    willDestroyElement() {
        super.willDestroyElement(...arguments);

        if (this._allowFocusListener) {
            END_EVENTS.forEach(eventName => window.removeEventListener(eventName, this._allowFocusListener));
        }
    }

    // actions

    @action
    optionMouseDown(event) {
        if (event.which === 1 && !event.ctrlKey) {
            this._denyFocus(event);
        }
    }

    @action
    optionTouchStart(event) {
        this._denyFocus(event);
    }

    @action
    handleFocus() {
        if (this._canFocus) {
            super.handleFocus(...arguments);
        }
    }

    // internal

    _denyFocus() {
        if (this._canFocus) {
            this._canFocus = false;

            this._allowFocusListener = bind(this, this._allowFocus);

            END_EVENTS.forEach(eventName => window.addEventListener(eventName, this._allowFocusListener));
        }
    }

    _allowFocus() {
        this._canFocus = true;

        END_EVENTS.forEach(eventName => window.removeEventListener(eventName, this._allowFocusListener));
        this._allowFocusListener = null;
    }
}

export default GhTokenInputSelectMultiple;
