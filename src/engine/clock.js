/**
 * Game clock for managing 1-second tick intervals
 * Provides precise timing for deterministic simulation
 */
export class Clock {
  constructor(interval = 1000) {
    this.interval = interval;
    this.timer = null;
    this.isRunning = false;
    this.tickCount = 0;
    this.callbacks = [];
  }
  
  /**
   * Add a callback to be executed on each tick
   */
  addCallback(callback) {
    this.callbacks.push(callback);
  }
  
  /**
   * Remove a callback
   */
  removeCallback(callback) {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }
  
  /**
   * Start the clock
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.tickCount++;
      this.callbacks.forEach(callback => {
        try {
          callback(this.tickCount);
        } catch (error) {
          console.error('Clock callback error:', error);
        }
      });
    }, this.interval);
  }
  
  /**
   * Stop the clock
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  
  /**
   * Reset the clock
   */
  reset() {
    this.stop();
    this.tickCount = 0;
  }
  
  /**
   * Get current tick count
   */
  getTick() {
    return this.tickCount;
  }
}
