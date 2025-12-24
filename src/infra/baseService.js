/**
 * Base service class for all infrastructure components
 * Provides provider-agnostic interface and common functionality
 */

export class BaseService {
  constructor(name, provider, capacity, baseCost) {
    this.id = this.generateId();
    this.name = name;
    this.provider = provider; // 'aws', 'gcp', 'azure'
    this.capacity = capacity; // requests per second
    this.baseCost = baseCost; // cost per minute
    this.currentLoad = 0;
    this.health = 'healthy'; // 'healthy', 'degraded', 'failed'
    
    // Performance metrics
    this.metrics = {
      requestsPerSecond: 0,
      averageLatency: 0,
      errorRate: 0,
      cost: 0,
      uptime: 100
    };
    
    // Service connections
    this.connections = []; // Connected service IDs
    this.position = { x: 0, y: 0 }; // For UI rendering
    
    // Performance characteristics (override in subclasses)
    this.latencyBase = 10; // Base latency in ms
    this.latencyMultiplier = 1.0; // How latency scales with load
    this.degradationThreshold = 0.8; // When performance starts degrading
    this.failureThreshold = 1.2; // When service starts dropping requests
  }
  
  /**
   * Generate unique service ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Process incoming requests (override in subclasses)
   */
  processRequests(requests) {
    const processed = [];
    const dropped = [];
    let totalLatency = 0;
    
    // Calculate current load ratio
    const loadRatio = requests.length / this.capacity;
    this.currentLoad = loadRatio;
    
    // Update health based on load
    this.updateHealth(loadRatio);
    
    // Process each request
    for (const request of requests) {
      if (this.shouldDropRequest(loadRatio)) {
        dropped.push(request);
        continue;
      }
      
      // Calculate latency for this request
      const latency = this.calculateLatency(loadRatio);
      request.latency += latency;
      totalLatency += latency;
      
      processed.push(request);
    }
    
    // Update metrics
    this.updateMetrics(processed.length, dropped.length, totalLatency);
    
    return { processed, dropped };
  }
  
  /**
   * Calculate latency based on current load
   */
  calculateLatency(loadRatio) {
    // Base latency increases exponentially with load
    const latency = this.latencyBase * (1 + Math.pow(loadRatio * this.latencyMultiplier, 2));
    return Math.round(latency);
  }
  
  /**
   * Determine if a request should be dropped
   */
  shouldDropRequest(loadRatio) {
    if (this.health === 'failed') {
      return true;
    }
    
    // Start dropping requests when over capacity
    if (loadRatio > this.failureThreshold) {
      // Drop probability increases with overload
      const dropProbability = (loadRatio - this.failureThreshold) / this.failureThreshold;
      return Math.random() < dropProbability;
    }
    
    return false;
  }
  
  /**
   * Update service health based on load
   */
  updateHealth(loadRatio) {
    if (loadRatio > this.failureThreshold) {
      this.health = 'failed';
    } else if (loadRatio > this.degradationThreshold) {
      this.health = 'degraded';
    } else {
      this.health = 'healthy';
    }
  }
  
  /**
   * Update service metrics
   */
  updateMetrics(processedCount, droppedCount, totalLatency) {
    const totalRequests = processedCount + droppedCount;
    
    this.metrics.requestsPerSecond = totalRequests;
    this.metrics.errorRate = totalRequests > 0 ? (droppedCount / totalRequests) * 100 : 0;
    this.metrics.averageLatency = processedCount > 0 ? totalLatency / processedCount : 0;
    this.metrics.cost = this.getCost();
    
    // Update uptime based on health
    if (this.health === 'failed') {
      this.metrics.uptime = Math.max(0, this.metrics.uptime - 1);
    } else if (this.health === 'healthy') {
      this.metrics.uptime = Math.min(100, this.metrics.uptime + 0.1);
    }
  }
  
  /**
   * Get current service cost (override in provider-specific implementations)
   */
  getCost() {
    // Base cost calculation - can be overridden for provider-specific pricing
    let cost = this.baseCost;
    
    // Add load-based cost scaling
    if (this.currentLoad > 0.5) {
      cost *= (1 + (this.currentLoad - 0.5));
    }
    
    return cost;
  }
  
  /**
   * Connect to another service
   */
  connectTo(serviceId) {
    if (!this.connections.includes(serviceId)) {
      this.connections.push(serviceId);
    }
  }
  
  /**
   * Disconnect from a service
   */
  disconnectFrom(serviceId) {
    const index = this.connections.indexOf(serviceId);
    if (index > -1) {
      this.connections.splice(index, 1);
    }
  }
  
  /**
   * Set service position for UI rendering
   */
  setPosition(x, y) {
    this.position = { x, y };
  }
  
  /**
   * Get service status for UI
   */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      provider: this.provider,
      health: this.health,
      currentLoad: this.currentLoad,
      capacity: this.capacity,
      metrics: { ...this.metrics },
      connections: [...this.connections],
      position: { ...this.position }
    };
  }
  
  /**
   * Reset service to initial state
   */
  reset() {
    this.currentLoad = 0;
    this.health = 'healthy';
    this.metrics = {
      requestsPerSecond: 0,
      averageLatency: 0,
      errorRate: 0,
      cost: 0,
      uptime: 100
    };
  }
  
  /**
   * Validate service configuration
   */
  validate() {
    const errors = [];
    
    if (!this.name || this.name.trim() === '') {
      errors.push('Service name is required');
    }
    
    if (!['aws', 'gcp', 'azure'].includes(this.provider)) {
      errors.push('Invalid provider - must be aws, gcp, or azure');
    }
    
    if (this.capacity <= 0) {
      errors.push('Capacity must be greater than 0');
    }
    
    if (this.baseCost < 0) {
      errors.push('Base cost cannot be negative');
    }
    
    return errors;
  }
}
