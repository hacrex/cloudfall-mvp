/**
 * Central game state management for CloudFall
 * Maintains all simulation data with provider-specific sections
 */
export class GameState {
  constructor() {
    this.tick = 0;
    this.isRunning = false;
    
    // Provider-specific service tracking
    this.providers = {
      aws: { services: [], totalCost: 0 },
      gcp: { services: [], totalCost: 0 },
      azure: { services: [], totalCost: 0 }
    };
    
    // Core game metrics
    this.metrics = {
      availability: 100,
      averageLatency: 0,
      totalCost: 0,
      reputation: 100,
      requestsProcessed: 0,
      requestsDropped: 0,
      requestsBlocked: 0,
      slaThreshold: 90,
      gameOver: false,
      gameOverReason: null
    };
    
    // Current scenario state
    this.scenario = null;
    
    // Traffic and request tracking
    this.currentRequests = [];
    this.trafficHistory = [];
    
    // Infrastructure topology
    this.services = new Map(); // serviceId -> service instance
    this.connections = new Map(); // serviceId -> [connected service IDs]
  }
  
  /**
   * Add a service to the infrastructure
   */
  addService(service) {
    this.services.set(service.id, service);
    this.providers[service.provider].services.push(service.id);
  }
  
  /**
   * Remove a service from the infrastructure
   */
  removeService(serviceId) {
    const service = this.services.get(serviceId);
    if (service) {
      const providerServices = this.providers[service.provider].services;
      const index = providerServices.indexOf(serviceId);
      if (index > -1) {
        providerServices.splice(index, 1);
      }
      this.services.delete(serviceId);
      this.connections.delete(serviceId);
    }
  }
  
  /**
   * Connect two services
   */
  connectServices(serviceId1, serviceId2) {
    if (!this.connections.has(serviceId1)) {
      this.connections.set(serviceId1, []);
    }
    if (!this.connections.has(serviceId2)) {
      this.connections.set(serviceId2, []);
    }
    
    this.connections.get(serviceId1).push(serviceId2);
    this.connections.get(serviceId2).push(serviceId1);
  }
  
  /**
   * Update metrics based on current tick results
   */
  updateMetrics(tickResults) {
    const { processed, dropped, blocked, totalLatency } = tickResults;
    
    this.metrics.requestsProcessed += processed;
    this.metrics.requestsDropped += dropped;
    this.metrics.requestsBlocked += blocked;
    
    // Calculate availability
    const totalRequests = processed + dropped;
    if (totalRequests > 0) {
      this.metrics.availability = (processed / totalRequests) * 100;
    }
    
    // Calculate average latency
    if (processed > 0) {
      this.metrics.averageLatency = totalLatency / processed;
    }
    
    // Update reputation (drops hurt, blocks help)
    this.metrics.reputation = Math.max(0, Math.min(100, 
      this.metrics.reputation - (dropped * 0.5) + (blocked * 0.1)
    ));
    
    // Calculate total cost
    this.metrics.totalCost = 0;
    for (const provider of Object.values(this.providers)) {
      provider.totalCost = 0;
      for (const serviceId of provider.services) {
        const service = this.services.get(serviceId);
        if (service) {
          const serviceCost = service.getCost();
          provider.totalCost += serviceCost;
          this.metrics.totalCost += serviceCost;
        }
      }
    }
    
    // Check game over conditions
    this.checkGameOverConditions();
  }
  
  /**
   * Check if game over conditions are met
   */
  checkGameOverConditions() {
    if (this.metrics.reputation <= 0) {
      this.metrics.gameOver = true;
      this.metrics.gameOverReason = 'Reputation reached zero';
    } else if (this.metrics.availability < this.metrics.slaThreshold) {
      // TODO: Add extended time tracking for SLA violations
      // For now, immediate game over on SLA breach
      this.metrics.gameOver = true;
      this.metrics.gameOverReason = `Availability below SLA threshold (${this.metrics.slaThreshold}%)`;
    }
  }
  
  /**
   * Reset game state for new game
   */
  reset() {
    this.tick = 0;
    this.isRunning = false;
    this.providers = {
      aws: { services: [], totalCost: 0 },
      gcp: { services: [], totalCost: 0 },
      azure: { services: [], totalCost: 0 }
    };
    this.metrics = {
      availability: 100,
      averageLatency: 0,
      totalCost: 0,
      reputation: 100,
      requestsProcessed: 0,
      requestsDropped: 0,
      requestsBlocked: 0,
      slaThreshold: 90,
      gameOver: false,
      gameOverReason: null
    };
    this.scenario = null;
    this.currentRequests = [];
    this.trafficHistory = [];
    this.services.clear();
    this.connections.clear();
  }
  
  /**
   * Get current game state snapshot
   */
  getSnapshot() {
    return {
      tick: this.tick,
      isRunning: this.isRunning,
      providers: JSON.parse(JSON.stringify(this.providers)),
      metrics: { ...this.metrics },
      serviceCount: this.services.size,
      scenario: this.scenario
    };
  }
}