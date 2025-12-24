/**
 * Main game loop orchestration for CloudFall
 * Coordinates all simulation systems through event-driven architecture
 */
import { Clock } from "./clock.js";
import { EventBus, EVENTS } from "./eventBus.js";
import { GameState } from "./gameState.js";
import { ServiceRegistry } from "../infra/serviceRegistry.js";
import { TrafficGenerator } from "../traffic/generator.js";

export class GameLoop {
  constructor() {
    this.eventBus = new EventBus();
    this.gameState = new GameState();
    this.clock = new Clock(1000); // 1-second ticks
    
    // Initialize subsystems
    this.serviceRegistry = new ServiceRegistry(this.eventBus, this.gameState);
    this.trafficGenerator = new TrafficGenerator(this.eventBus, this.gameState);
    
    this.setupEventHandlers();
    this.setupClockCallback();
  }
  
  /**
   * Set up core event handlers
   */
  setupEventHandlers() {
    // Handle game over conditions
    this.eventBus.on(EVENTS.GAME_OVER, (reason) => {
      this.pause();
      console.log('Game Over:', reason);
    });
    
    // Handle game reset
    this.eventBus.on(EVENTS.GAME_RESET, () => {
      this.reset();
    });
  }
  
  /**
   * Set up clock callback for main game tick
   */
  setupClockCallback() {
    this.clock.addCallback((tickNumber) => {
      this.executeTick(tickNumber);
    });
  }
  
  /**
   * Execute a single game tick
   * Follows the sequence: Generate -> Route -> Process -> Calculate -> Update -> Render
   */
  executeTick(tickNumber) {
    if (this.gameState.metrics.gameOver) {
      this.pause();
      return;
    }
    
    this.gameState.tick = tickNumber;
    
    // 1. Start tick
    this.eventBus.emit(EVENTS.TICK_START, {
      tick: tickNumber,
      gameState: this.gameState.getSnapshot()
    });
    
    // 2. Generate traffic (handled by traffic generator)
    this.eventBus.emit(EVENTS.TRAFFIC_GENERATED, {
      tick: tickNumber
    });
    
    // 3. Process requests through infrastructure (handled by service registry)
    this.eventBus.emit(EVENTS.REQUESTS_PROCESSED, {
      tick: tickNumber,
      requests: this.gameState.currentRequests
    });
    
    // 4. Update metrics (handled by scoring system)
    this.eventBus.emit(EVENTS.METRICS_UPDATED, {
      tick: tickNumber,
      gameState: this.gameState
    });
    
    // 5. Update UI (handled by renderer)
    this.eventBus.emit(EVENTS.UI_UPDATE, {
      tick: tickNumber,
      gameState: this.gameState.getSnapshot()
    });
    
    // Check for game over conditions
    if (this.gameState.metrics.gameOver) {
      this.eventBus.emit(EVENTS.GAME_OVER, this.gameState.metrics.gameOverReason);
    }
  }
  
  /**
   * Start the game loop
   */
  start() {
    if (this.gameState.metrics.gameOver) {
      console.warn('Cannot start game - game over condition active');
      return;
    }
    
    this.gameState.isRunning = true;
    this.clock.start();
    console.log('CloudFall game started');
  }
  
  /**
   * Pause the game loop
   */
  pause() {
    this.gameState.isRunning = false;
    this.clock.stop();
    console.log('CloudFall game paused');
  }
  
  /**
   * Reset the game to initial state
   */
  reset() {
    this.clock.reset();
    this.gameState.reset();
    this.serviceRegistry.reset();
    this.trafficGenerator.reset();
    this.eventBus.clearHistory();
    console.log('CloudFall game reset');
  }
  
  /**
   * Get the event bus for external systems to subscribe
   */
  getEventBus() {
    return this.eventBus;
  }
  
  /**
   * Get the game state for external systems to read
   */
  getGameState() {
    return this.gameState;
  }
  
  /**
   * Get the service registry for service management
   */
  getServiceRegistry() {
    return this.serviceRegistry;
  }
  
  /**
   * Get the traffic generator for traffic management
   */
  getTrafficGenerator() {
    return this.trafficGenerator;
  }
  
  /**
   * Get current game status
   */
  getStatus() {
    return {
      isRunning: this.gameState.isRunning,
      tick: this.gameState.tick,
      gameOver: this.gameState.metrics.gameOver,
      gameOverReason: this.gameState.metrics.gameOverReason,
      serviceCount: this.serviceRegistry.services.size,
      healthSummary: this.serviceRegistry.getHealthSummary(),
      costSummary: this.serviceRegistry.getCostSummary(),
      trafficStats: this.trafficGenerator.getStatistics()
    };
  }
}

// Create and export singleton instance
export const gameLoop = new GameLoop();
