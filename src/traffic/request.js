/**
 * Request model for CloudFall traffic simulation
 * Represents user requests, bot traffic, and attacks flowing through infrastructure
 */

export class Request {
  constructor(type = 'user', source = 'organic') {
    this.id = this.generateId();
    this.type = type; // 'user', 'bot', 'attack'
    this.source = source; // 'organic', 'campaign', 'ddos', 'scraping'
    this.timestamp = Date.now();
    this.path = '/';
    this.processed = false;
    this.dropped = false;
    this.blocked = false;
    this.latency = 0;
    this.provider = null; // Which provider processed this request
    
    // Request characteristics
    this.latencyTolerance = this.calculateLatencyTolerance();
    this.value = this.calculateValue();
    this.size = this.calculateSize(); // Request size in KB
    
    // Processing history
    this.processingPath = []; // Services that processed this request
    this.errors = [];
  }
  
  /**
   * Generate unique request ID
   */
  generateId() {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }
  
  /**
   * Calculate latency tolerance based on request type
   */
  calculateLatencyTolerance() {
    switch (this.type) {
      case 'user':
        return Math.random() * 2000 + 1000; // 1-3 seconds for users
      case 'bot':
        return Math.random() * 5000 + 5000; // 5-10 seconds for bots
      case 'attack':
        return Math.random() * 100 + 50; // 50-150ms for attacks (impatient)
      default:
        return 2000;
    }
  }
  
  /**
   * Calculate business value of the request
   */
  calculateValue() {
    switch (this.type) {
      case 'user':
        // Users have high value, varies by source
        if (this.source === 'organic') {
          return Math.random() * 10 + 5; // $5-15 value
        } else if (this.source === 'campaign') {
          return Math.random() * 8 + 3; // $3-11 value
        }
        return Math.random() * 5 + 2; // $2-7 value
      case 'bot':
        // Bots have some value (legitimate crawlers)
        return Math.random() * 2 + 0.5; // $0.5-2.5 value
      case 'attack':
        // Attacks have negative value
        return -(Math.random() * 5 + 1); // -$1 to -$6 value
      default:
        return 1;
    }
  }
  
  /**
   * Calculate request size
   */
  calculateSize() {
    switch (this.type) {
      case 'user':
        return Math.random() * 50 + 10; // 10-60 KB
      case 'bot':
        return Math.random() * 20 + 5; // 5-25 KB
      case 'attack':
        return Math.random() * 100 + 200; // 200-300 KB (large payloads)
      default:
        return 20;
    }
  }
  
  /**
   * Add latency to the request
   */
  addLatency(amount) {
    this.latency += amount;
  }
  
  /**
   * Mark request as processed by a service
   */
  markProcessed(serviceId, serviceName) {
    this.processed = true;
    this.processingPath.push({
      serviceId,
      serviceName,
      timestamp: Date.now(),
      latency: this.latency
    });
  }
  
  /**
   * Mark request as dropped
   */
  markDropped(reason, serviceId = null) {
    this.dropped = true;
    this.errors.push({
      type: 'dropped',
      reason,
      serviceId,
      timestamp: Date.now()
    });
  }
  
  /**
   * Mark request as blocked (by WAF)
   */
  markBlocked(reason, serviceId = null) {
    this.blocked = true;
    this.errors.push({
      type: 'blocked',
      reason,
      serviceId,
      timestamp: Date.now()
    });
  }
  
  /**
   * Check if request has exceeded latency tolerance
   */
  hasExceededTolerance() {
    return this.latency > this.latencyTolerance;
  }
  
  /**
   * Get request status
   */
  getStatus() {
    if (this.blocked) return 'blocked';
    if (this.dropped) return 'dropped';
    if (this.processed) return 'processed';
    return 'pending';
  }
  
  /**
   * Get request summary for metrics
   */
  getSummary() {
    return {
      id: this.id,
      type: this.type,
      source: this.source,
      status: this.getStatus(),
      latency: this.latency,
      latencyTolerance: this.latencyTolerance,
      value: this.value,
      size: this.size,
      processingPath: this.processingPath.length,
      errors: this.errors.length,
      exceededTolerance: this.hasExceededTolerance()
    };
  }
  
  /**
   * Clone request (for routing through multiple paths)
   */
  clone() {
    const cloned = new Request(this.type, this.source);
    cloned.path = this.path;
    cloned.latencyTolerance = this.latencyTolerance;
    cloned.value = this.value;
    cloned.size = this.size;
    return cloned;
  }
  
  /**
   * Validate request data
   */
  validate() {
    const errors = [];
    
    if (!['user', 'bot', 'attack'].includes(this.type)) {
      errors.push('Invalid request type');
    }
    
    if (!this.id || this.id.trim() === '') {
      errors.push('Request ID is required');
    }
    
    if (this.latency < 0) {
      errors.push('Latency cannot be negative');
    }
    
    if (this.size <= 0) {
      errors.push('Request size must be positive');
    }
    
    return errors;
  }
}
