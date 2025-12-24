/**
 * Main entry point for CloudFall game
 * Initializes all systems and starts the game
 */
import { gameLoop } from './engine/gameLoop.js';
import { EVENTS } from './engine/eventBus.js';

// Initialize game systems
function initializeGame() {
  const eventBus = gameLoop.getEventBus();
  const gameState = gameLoop.getGameState();
  
  console.log('Initializing CloudFall...');
  
  // Set up basic event logging for development
  eventBus.on(EVENTS.TICK_START, (data) => {
    if (data.tick % 10 === 0) { // Log every 10 ticks
      console.log(`Tick ${data.tick} - Running simulation...`);
    }
  });
  
  eventBus.on(EVENTS.GAME_OVER, (reason) => {
    console.log('🚨 Game Over:', reason);
    console.log('Final metrics:', gameState.metrics);
  });
  
  // Add basic UI controls
  setupUIControls();
  
  console.log('CloudFall initialized successfully');
  console.log('Game controls: Use browser console or UI buttons');
}

// Set up basic UI controls
function setupUIControls() {
  // Add start/pause/reset buttons to the page
  const controlsDiv = document.createElement('div');
  controlsDiv.id = 'game-controls';
  controlsDiv.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    z-index: 1000;
    background: rgba(0,0,0,0.8);
    padding: 10px;
    border-radius: 5px;
    color: #00ff9c;
    font-family: 'Courier New', monospace;
  `;
  
  const startBtn = document.createElement('button');
  startBtn.textContent = 'Start';
  startBtn.onclick = () => gameLoop.start();
  
  const pauseBtn = document.createElement('button');
  pauseBtn.textContent = 'Pause';
  pauseBtn.onclick = () => gameLoop.pause();
  
  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset';
  resetBtn.onclick = () => gameLoop.reset();
  
  // Style buttons
  [startBtn, pauseBtn, resetBtn].forEach(btn => {
    btn.style.cssText = `
      margin: 0 5px;
      padding: 5px 10px;
      background: #1a1f2e;
      color: #00ff9c;
      border: 1px solid #00ff9c;
      border-radius: 3px;
      cursor: pointer;
      font-family: 'Courier New', monospace;
    `;
    btn.onmouseover = () => btn.style.background = '#00ff9c20';
    btn.onmouseout = () => btn.style.background = '#1a1f2e';
  });
  
  controlsDiv.appendChild(startBtn);
  controlsDiv.appendChild(pauseBtn);
  controlsDiv.appendChild(resetBtn);
  
  document.body.appendChild(controlsDiv);
}

// Expose game loop to global scope for console access
window.CloudFall = {
  gameLoop,
  start: () => gameLoop.start(),
  pause: () => gameLoop.pause(),
  reset: () => gameLoop.reset(),
  status: () => gameLoop.getStatus(),
  state: () => gameLoop.getGameState().getSnapshot(),
  services: () => gameLoop.getServiceRegistry(),
  traffic: () => gameLoop.getTrafficGenerator(),
  deployService: (service) => gameLoop.getServiceRegistry().deployService(service),
  removeService: (serviceId) => gameLoop.getServiceRegistry().removeService(serviceId),
  triggerSpike: (multiplier, duration) => gameLoop.getTrafficGenerator().triggerTrafficSpike(multiplier, duration)
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeGame);
} else {
  initializeGame();
}

console.log('CloudFall loaded. Use CloudFall.start() to begin or click the Start button.');