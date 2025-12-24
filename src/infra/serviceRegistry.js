/**
 * Service registry for managing infrastructure services
 * Provides centralized service management and routing
 */
import { EVENTS } from '../engine/eventBus.js';

export class ServiceRegistry {
  constructor(eventBus, gameState) {
    this.eventBus = eventBus;
    this.gameState = gameState;
    this.services = new Map(); // serviceId -> service instance
    
    this.setupEventHandlers();
  }
  
  /**
   * Set up event handlers for service management
   */
  setupEventHandlers() {
    this.eventBus.on(EVENTS.SERVICE_DEPLOYED, (data) => {
      this.deployService(data.service);
    });
    
    this.eventBus.on(EVENTS.SERVICE_REMOVED, (data) => {
      this.removeService(data.serviceId);
    });
    
    this.eventBus.on(EVENTS.REQUESTS_PROCESSED, (data) => {
      this.processRequests(data.requests);
    });
  }
  
  /**
   * Deploy a new service
   */
  deployService(service) {
    // Validate service configuration
    const errors = service.validate();
    if (errors.length > 0) {
      console.error('Service validation failed:', errors);
      return false;
    }
    
    // Add to registry
    this.services.set(service.id, service);
    this.gameState.addService(service);
    
    console.log(`Service deployed: ${service.name} (${service.provider})`);
    return true;
  }
  
  /**
   * Remove a service
   */
  removeService(serviceId) {
    const service = this.services.get(serviceId);
    if (service) {
      this.services.delete(serviceId);
      this.gameState.removeService(serviceId);
      console.log(`Service removed: ${service.name}`);
      return true;
    }
    return false;
  }
  
  /**
   * Process requests through all services
   */
  processRequests(requests) {
    if (!requests || requests.length === 0) {
      return { processed: 0, dropped: 0, blocked: 0, totalLatency: 0 };
    }
    
    let totalProcessed = 0;
    let totalDropped = 0;
    let totalBlocked = 0;
    let totalLatency = 0;
    
    // Route requests through services based on topology
    const routedRequests = this.routeRequests(requests);
    
    // Process requests through each service
    for (const [serviceId, serviceRequests] of routedRequests.entries()) {
      const service = this.services.get(serviceId);
      if (service) {
        const result = service.processRequests(serviceRequests);
        
        totalProcessed += result.processed.length;
        totalDropped += result.dropped.length;
        
        // Accumulate latency
        for (const request of result.processed) {
          totalLatency += request.latency;
        }
      }
    }
    
    // Update game state metrics
    this.gameState.updateMetrics({
      processed: totalProcessed,
      dropped: totalDropped,
      blocked: totalBlocked,
      totalLatency: totalLatency
    });
    
    return { processed: totalProcessed, dropped: totalDropped, blocked: totalBlocked, totalLatency };
  }
  
  /**
   * Route requests through service topology
   * For now, simple routing - will be enhanced with load balancers
   */
  routeRequests(requests) {
    const routedRequests = new Map();
    
    // If no services, all requests are dropped
    if (this.services.size === 0) {
      return routedRequests;
    }
    
    // Simple round-robin routing to all services for now
    // This will be replaced with proper load balancer routing
    const serviceIds = Array.from(this.services.keys());
    
    requests.forEach((request, index) => {
      const serviceId = serviceIds[index % serviceIds.length];
      
      if (!routedRequests.has(serviceId)) {
        routedRequests.set(serviceId, []);
      }
      
      routedRequests.get(serviceId).push(request);
    });
    
    return routedRequests;
  }
  
  /**
   * Get service by ID
   */
  getService(serviceId) {
    return this.services.get(serviceId);
  }
  
  /**
   * Get all services
   */
  getAllServices() {
    return Array.from(this.services.values());
  }
  
  /**
   * Get services by provider
   */
  getServicesByProvider(provider) {
    return Array.from(this.services.values()).filter(service => service.provider === provider);
  }
  
  /**
   * Get services by type
   */
  getServicesByType(type) {
    return Array.from(this.services.values()).filter(service => service.constructor.name.toLowerCase().includes(type.toLowerCase()));
  }
  
  /**
   * Get service health summary
   */
  getHealthSummary() {
    const summary = {
      total: this.services.size,
      healthy: 0,
      degraded: 0,
      failed: 0
    };
    
    for (const service of this.services.values()) {
      summary[service.health]++;
    }
    
    return summary;
  }
  
  /**
   * Get cost summary by provider
   */
  getCostSummary() {
    const summary = {
      aws: 0,
      gcp: 0,
      azure: 0,
      total: 0
    };
    
    for (const service of this.services.values()) {
      const cost = service.getCost();
      summary[service.provider] += cost;
      summary.total += cost;
    }
    
    return summary;
  }
  
  /**
   * Reset all services
   */
  reset() {
    for (const service of this.services.values()) {
      service.reset();
    }
  }
  
  /**
   * Validate all services
   */
  validateAll() {
    const allErrors = [];
    
    for (const service of this.services.values()) {
      const errors = service.validate();
      if (errors.length > 0) {
        allErrors.push({
          serviceId: service.id,
          serviceName: service.name,
          errors: errors
        });
      }
    }
    
    return allErrors;
  }
}