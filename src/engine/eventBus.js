/**
 * Event bus for coordinating all component communication
 * Provides decoupled messaging between game systems
 */

// Core event types
export const EVENTS = {
  TICK_START: 'tick_start',
  TRAFFIC_GENERATED: 'traffic_generated',
  REQUESTS_PROCESSED: 'requests_processed',
  METRICS_UPDATED: 'metrics_updated',
  SERVICE_DEPLOYED: 'service_deployed',
  SERVICE_REMOVED: 'service_removed',
  PROVIDER_CHANGED: 'provider_changed',
  GAME_OVER: 'game_over',
  GAME_RESET: 'game_reset',
  UI_UPDATE: 'ui_update'
};

export class EventBus {
  constructor() {
    this.events = {};
    this.eventHistory = [];
    this.maxHistorySize = 1000;
  }
  
  /**
   * Subscribe to an event
   */
  on(eventType, handler) {
    if (!this.events[eventType]) {
      this.events[eventType] = [];
    }
    this.events[eventType].push(handler);
  }
  
  /**
   * Unsubscribe from an event
   */
  off(eventType, handler) {
    if (!this.events[eventType]) return;
    
    const index = this.events[eventType].indexOf(handler);
    if (index > -1) {
      this.events[eventType].splice(index, 1);
    }
  }
  
  /**
   * Emit an event to all subscribers
   */
  emit(eventType, payload = null) {
    // Log event for debugging and replay
    const eventRecord = {
      type: eventType,
      payload: payload,
      timestamp: Date.now()
    };
    
    this.eventHistory.push(eventRecord);
    
    // Maintain history size limit
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
    
    // Emit to all handlers
    if (this.events[eventType]) {
      this.events[eventType].forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Event handler error for ${eventType}:`, error);
        }
      });
    }
  }
  
  /**
   * Get event history for debugging/replay
   */
  getEventHistory() {
    return [...this.eventHistory];
  }
  
  /**
   * Clear event history
   */
  clearHistory() {
    this.eventHistory = [];
  }
  
  /**
   * Get all current subscriptions (for debugging)
   */
  getSubscriptions() {
    const subscriptions = {};
    for (const [eventType, handlers] of Object.entries(this.events)) {
      subscriptions[eventType] = handlers.length;
    }
    return subscriptions;
  }
}
