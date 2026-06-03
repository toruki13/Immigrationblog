self.deprecationWorkflow = self.deprecationWorkflow || {};
self.deprecationWorkflow.config = {
    workflow: [
        // All pre-4.0 deprecations resolved via addon upgrades.
        // ember-drag-drop 1.0.1: sendAction removed
        // liquid-fire 0.37.1: this.$() removed
        // ember-power-datepicker 1.0.7: Ember 4.x compatible
    ]
};
