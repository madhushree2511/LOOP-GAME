import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Trophy, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

const GRID_SIZE = 20; // Fewer cells = larger boxes
const INITIAL_SNAKE = [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }];
const INITIAL_DIRECTION = { x: 1, y: 0 };

type Point = { x: number; y: number };
type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

const DIFFICULTY_SETTINGS = {
  EASY: { interval: 180, label: 'EASY' },
  MEDIUM: { interval: 130, label: 'MEDIUM' },
  HARD: { interval: 80, label: 'HARD' }
};

// High-quality realistic assets
const SNAKE_HEAD_IMG = 'https://cdn-icons-png.flaticon.com/512/3521/3521757.png'; // More detailed snake head
const FOOD_IMG = 'https://cdn-icons-png.flaticon.com/512/415/415733.png'; // High-def red apple

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headImageRef = useRef<HTMLImageElement | null>(null);
  const foodImageRef = useRef<HTMLImageElement | null>(null);
  const lastMoveTimeRef = useRef<number>(0);
  const tongueTimerRef = useRef<number>(0); // For flickering tongue effect
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeHissRef = useRef<AudioBufferSourceNode | null>(null);

  const [snake, setSnake] = useState<Point[]>(INITIAL_SNAKE);
  const [direction, setDirection] = useState<Point>(INITIAL_DIRECTION);
  const [nextDirection, setNextDirection] = useState<Point>(INITIAL_DIRECTION);
  const [food, setFood] = useState<Point>({ x: 15, y: 10 });
  const [score, setScore] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isEating, setIsEating] = useState(false);

  // --- AUDIO ENGINE ---
  const playSound = useCallback((type: 'EAT' | 'DIE' | 'UI' | 'HISS') => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);

      if (type === 'HISS') {
        if (activeHissRef.current) {
          try { activeHissRef.current.stop(); } catch (e) {}
        }

        const bufferSize = ctx.sampleRate * 0.4;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        activeHissRef.current = noise;

        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(6000, now);
        noise.connect(filter);
        filter.connect(gain);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.1); 
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        
        noise.onended = () => { if (activeHissRef.current === noise) activeHissRef.current = null; };
        noise.start(now);
        noise.stop(now + 0.4);
        return;
      }

      const osc = ctx.createOscillator();
      osc.connect(gain);

      if (type === 'EAT') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.1);
        gain.gain.setValueAtTime(0.2, now); // Increased from 0.05
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'DIE') {
        const fBufferSize = ctx.sampleRate * 0.1;
        const fBuffer = ctx.createBuffer(1, fBufferSize, ctx.sampleRate);
        const fData = fBuffer.getChannelData(0);
        for (let i = 0; i < fBufferSize; i++) fData[i] = Math.random() * 0.5;
        const fNoise = ctx.createBufferSource();
        fNoise.buffer = fBuffer;
        const fFilter = ctx.createBiquadFilter();
        fFilter.type = 'highpass';
        fFilter.frequency.setValueAtTime(4000, now);
        fNoise.connect(fFilter);
        fFilter.connect(gain);
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, now + 0.05);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.6);
        
        const vFilter = ctx.createBiquadFilter();
        vFilter.type = 'bandpass';
        vFilter.frequency.setValueAtTime(1000, now + 0.05); 
        vFilter.Q.setValueAtTime(5, now + 0.05);
        
        osc.connect(vFilter);
        vFilter.connect(gain);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.4, now + 0.05); // Boosted from 0.2
        gain.gain.linearRampToValueAtTime(0.2, now + 0.6); // Boosted from 0.1
        gain.gain.linearRampToValueAtTime(0, now + 0.8);
        
        fNoise.start(now);
        fNoise.stop(now + 0.1);
        osc.start(now + 0.05);
        osc.stop(now + 0.8);
      } else if (type === 'UI') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        gain.gain.setValueAtTime(0.1, now); // Increased from 0.02
        gain.gain.linearRampToValueAtTime(0, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      }
    } catch (e) {
      console.warn("Audio Context Error", e);
    }
  }, []);

  // Browser Autoplay Unlocker
  useEffect(() => {
    const unlock = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    };
    window.addEventListener('mousedown', unlock);
    window.addEventListener('touchstart', unlock);
    return () => {
      window.removeEventListener('mousedown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  // Load assets on mount
  useEffect(() => {
    const head = new Image();
    head.src = SNAKE_HEAD_IMG;
    head.referrerPolicy = 'no-referrer';
    head.onload = () => { headImageRef.current = head; };

    const apple = new Image();
    apple.src = FOOD_IMG;
    apple.referrerPolicy = 'no-referrer';
    apple.onload = () => { foodImageRef.current = apple; };
  }, []);
  const [highScore, setHighScore] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Use refs for values needed in the loop to avoid dependency-induced restarts
  const stateRef = useRef({
    isStarted,
    isPaused,
    isGameOver,
    countdown,
    nextDirection,
    food,
    snake
  });

  useEffect(() => {
    stateRef.current = { isStarted, isPaused, isGameOver, countdown, nextDirection, food, snake };
  }, [isStarted, isPaused, isGameOver, countdown, nextDirection, food, snake]);

  // Load High Score
  useEffect(() => {
    const saved = localStorage.getItem('neon-snake-highscore');
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  // Save High Score
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('neon-snake-highscore', score.toString());
    }
  }, [score, highScore]);

  const generateFood = useCallback((currentSnake: Point[]) => {
    let newFood;
    let attempts = 0;
    while (attempts < 100) {
      newFood = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
      const onSnake = currentSnake.some(segment => segment.x === newFood.x && segment.y === newFood.y);
      if (!onSnake) return newFood;
      attempts++;
    }
    return { x: 1, y: 1 };
  }, []);

  const resetGame = () => {
    playSound('UI');
    setSnake(INITIAL_SNAKE);
    setDirection(INITIAL_DIRECTION);
    setNextDirection(INITIAL_DIRECTION);
    setFood(generateFood(INITIAL_SNAKE));
    setScore(0);
    setIsGameOver(false);
    setIsPaused(false);
    setIsShaking(false);
    lastMoveTimeRef.current = performance.now();
    setCountdown(3);
  };

  // Countdown Logic
  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setIsStarted(true);
      setCountdown(null);
    }
  }, [countdown]);

  const handleDeath = () => {
    // Stop all movement and ambient sounds immediately
    setIsStarted(false); 
    if (activeHissRef.current) {
      try { activeHissRef.current.stop(); } catch (e) {}
      activeHissRef.current = null;
    }
    playSound('DIE');
    setIsShaking(true);
    setTimeout(() => {
      setIsGameOver(true);
      setIsShaking(false);
    }, 400);
  };

  const moveSnake = useCallback(() => {
    const { isPaused, isGameOver, isStarted, countdown, nextDirection, food, snake: currentSnake } = stateRef.current;
    if (isPaused || isGameOver || !isStarted || countdown !== null) return;

    const head = currentSnake[0];
    const newHead = {
      x: head.x + nextDirection.x,
      y: head.y + nextDirection.y,
    };

    // Collision handling - calculated BEFORE state update for immediate feedback
    if (newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE || 
        currentSnake.some(segment => segment.x === newHead.x && segment.y === newHead.y)) {
      handleDeath();
      return;
    }

    setDirection(nextDirection);
    setSnake(prevSnake => {
      const newSnake = [newHead, ...prevSnake];

      if (newHead.x === food.x && newHead.y === food.y) {
        playSound('EAT');
        setScore(s => s + 1);
        setFood(generateFood(newSnake));
        
        // Trigger Effects
        setIsEating(true);
        setTimeout(() => setIsEating(false), 200);
        
        const newParticles: Particle[] = [];
        for (let i = 0; i < 8; i++) {
          newParticles.push({
            x: food.x * (canvasRef.current?.width || 400) / GRID_SIZE + ((canvasRef.current?.width || 400) / GRID_SIZE) / 2,
            y: food.y * (canvasRef.current?.width || 400) / GRID_SIZE + ((canvasRef.current?.width || 400) / GRID_SIZE) / 2,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            life: 1.0,
            color: '#ff3131'
          });
        }
        setParticles(prev => [...prev, ...newParticles]);
      } else {
        newSnake.pop();
      }

      // Randomly trigger HISS sound (approx 5% chance per move)
      if (Math.random() < 0.05) {
        playSound('HISS');
      }

      return newSnake;
    });
  }, [generateFood]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width / GRID_SIZE;

    // Update Particles
    setParticles(prev => prev
      .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, life: p.life - 0.05 }))
      .filter(p => p.life > 0)
    );

    // Clear board
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw Particles
    particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;
    
    // Grid lines - slightly more transparent for bigger grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.3;
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i * size, 0); ctx.lineTo(i * size, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * size); ctx.lineTo(canvas.width, i * size); ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // Food (Real Apple)
    const { food: currentFood } = stateRef.current;
    if (foodImageRef.current) {
      ctx.drawImage(
        foodImageRef.current,
        currentFood.x * size + 2,
        currentFood.y * size + 2,
        size - 4,
        size - 4
      );
    } else {
      ctx.fillStyle = '#ff3131';
      ctx.beginPath();
      ctx.arc(currentFood.x * size + size / 2, currentFood.y * size + size / 2, size / 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snake (Realistic)
    snake.forEach((segment, index) => {
      const x = segment.x * size;
      const y = segment.y * size;
      
      // Tapering: Snake gets thinner towards the tail
      const taperFactor = Math.max(0.6, 1 - (index / (snake.length + 5)));
      const currentSize = size * taperFactor;
      const offset = (size - currentSize) / 2;

      if (index === 0) {
        // --- DRAW REALISTIC HEAD ---
        ctx.save();
        ctx.translate(x + size / 2, y + size / 2);
        
        const { nextDirection: dir } = stateRef.current;
        let angle = 0;
        if (dir.x === 1) angle = Math.PI / 2;
        if (dir.x === -1) angle = -Math.PI / 2;
        if (dir.y === 1) angle = Math.PI;
        if (dir.y === -1) angle = 0;
        ctx.rotate(angle);

        // Flickering Tongue
        const time = Date.now();
        if (Math.sin(time / 200) > 0.6) {
          ctx.strokeStyle = '#ff3131';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, -size / 2);
          ctx.lineTo(0, -size / 2 - 12);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, -size / 2 - 12);
          ctx.lineTo(-4, -size / 2 - 16);
          ctx.moveTo(0, -size / 2 - 12);
          ctx.lineTo(4, -size / 2 - 16);
          ctx.stroke();
        }

        // Head Shape (Diamond/Viper shape)
        ctx.beginPath();
        ctx.moveTo(0, -size / 2 - 4);
        ctx.bezierCurveTo(size / 2, -size / 4, size / 1.8, size / 4, size / 3, size / 2);
        ctx.lineTo(-size / 3, size / 2);
        ctx.bezierCurveTo(-size / 1.8, size / 4, -size / 2, -size / 4, 0, -size / 2 - 4);
        
        const headGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, size / 2);
        headGrad.addColorStop(0, isEating ? '#fff' : '#4ade80');
        headGrad.addColorStop(0.8, '#166534'); 
        headGrad.addColorStop(1, '#052e16');
        ctx.fillStyle = headGrad;
        
        if (isEating) {
          ctx.shadowBlur = 30;
          ctx.shadowColor = '#4ade80';
        }
        
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Realistic Eyes
        const drawEye = (eyeX: number) => {
          ctx.save();
          ctx.shadowBlur = 4;
          ctx.shadowColor = '#fbbf24';
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.ellipse(eyeX, -size / 6, 4, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.ellipse(eyeX, -size / 6, 1, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        };
        drawEye(-size / 4);
        drawEye(size / 4);

        ctx.restore();
      } else {
        // Draw Body Segment with Realism
        ctx.save();
        
        // Shadow for depth
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowOffsetY = 2;

        const bodyX = x + offset;
        const bodyY = y + offset;

        // Organic Gradient
        const grad = ctx.createRadialGradient(bodyX + currentSize/2, bodyY + currentSize/2, 2, bodyX + currentSize/2, bodyY + currentSize/2, currentSize/2);
        grad.addColorStop(0, '#39ff14');
        grad.addColorStop(0.7, '#1b5e20');
        grad.addColorStop(1, '#0a2a0a');
        ctx.fillStyle = grad;
        
        // Rounded Segment
        ctx.beginPath();
        const r = currentSize / 2.5;
        ctx.roundRect ? ctx.roundRect(bodyX, bodyY, currentSize, currentSize, r) : ctx.rect(bodyX, bodyY, currentSize, currentSize);
        ctx.fill();

        // Glossy Highlight (Wet look)
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.ellipse(bodyX + currentSize/3, bodyY + currentSize/3, currentSize/5, currentSize/8, -Math.PI/4, 0, Math.PI*2);
        ctx.fill();

        // Scale texture
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(bodyX + currentSize/4, bodyY + currentSize/4);
        ctx.lineTo(bodyX + currentSize*3/4, bodyY + currentSize*3/4);
        ctx.stroke();
        
        ctx.restore();
      }
    });
    ctx.shadowBlur = 0;
  }, [snake]);

  // Unified Single Loop Effect
  useEffect(() => {
    let frameId: number;

    const loop = (time: number) => {
      if (!lastMoveTimeRef.current) lastMoveTimeRef.current = time;
      
      const elapsed = time - lastMoveTimeRef.current;
      
      // Strict movement interval based on difficulty
      const currentInterval = DIFFICULTY_SETTINGS[difficulty].interval;
      if (elapsed >= currentInterval) {
        moveSnake();
        lastMoveTimeRef.current = time;
      }

      draw();
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [moveSnake, draw, difficulty]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!isStarted) resetGame();
        else if (isGameOver) resetGame();
        else {
          playSound('UI');
          setIsPaused(!isPaused);
        }
        return;
      }

      if (isPaused || isGameOver || !isStarted) return;

      const keys: Record<string, Point> = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        KeyW: { x: 0, y: -1 },
        KeyS: { x: 0, y: 1 },
        KeyA: { x: -1, y: 0 },
        KeyD: { x: 1, y: 0 },
      };

      const newDir = keys[e.code];
      if (newDir) {
        e.preventDefault();
        // Prevent 180 degree turns
        if (newDir.x !== -direction.x || newDir.y !== -direction.y) {
          setNextDirection(newDir);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [direction, isPaused, isGameOver, isStarted]);

  const handleDirectionBtn = (dir: Point) => {
    if (isPaused || isGameOver || !isStarted) return;
    if (dir.x !== -direction.x || dir.y !== -direction.y) {
      setNextDirection(dir);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="w-full max-w-md flex justify-between items-end mb-6">
        <div className="text-left">
          <div className="h-8 w-48 bg-gradient-to-r from-emerald-400 to-green-500 rounded-sm shadow-[0_0_20px_rgba(52,211,153,0.4)] flex items-center px-3 mb-1">
            <span className="text-black font-black text-xs tracking-[0.4em]">LOOP</span>
          </div>
          <p className="text-[8px] font-mono text-slate-500 uppercase tracking-widest pl-1">Protocol v1.0.4 - Secure Connection</p>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-2 text-slate-500 font-mono text-[10px] leading-none mb-1">
            <Trophy size={10} className="text-yellow-600/50" />
            <span>{highScore.toString().padStart(6, '0')}</span>
          </div>
          <div className="text-2xl font-bold font-mono text-white leading-none">
            {score.toString().padStart(6, '0')}
          </div>
        </div>
      </div>

      {/* Game Container */}
      <div className={`relative border-[6px] border-[#3f3f1c] bg-black rounded p-0.5 overflow-hidden transition-all duration-300 shadow-[0_0_40px_rgba(0,0,0,0.8)] ${isShaking ? 'shake-effect' : ''}`}>
        <canvas
          id="gameCanvas"
          ref={canvasRef}
          width={400}
          height={400}
          className="max-w-full h-auto aspect-square rounded"
        />

        {/* Scanline Effect Layer */}
        <div className="absolute inset-0 pointer-events-none z-[15] opacity-[0.03] overflow-hidden rounded">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%]" />
        </div>

        {/* Overlays */}
        <AnimatePresence>
          {!isStarted && countdown === null && !isGameOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 overflow-hidden"
            >
              {/* Tech Brackets */}
              <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-[var(--color-neon-green)] opacity-40" />
              <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-[var(--color-neon-green)] opacity-40" />
              <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-[var(--color-neon-green)] opacity-40" />
              <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-[var(--color-neon-green)] opacity-40" />

              {/* Background Tech Detail */}
              <div className="absolute -bottom-10 -right-10 opacity-5 rotate-12">
                <RotateCcw size={200} />
              </div>
              <div className="absolute top-10 left-10 opacity-5 -rotate-12">
                <Trophy size={120} />
              </div>

              {/* Data Points */}
              <div className="absolute top-6 left-1/2 -translate-x-1/2 flex gap-4 text-[8px] font-mono text-emerald-500/40 uppercase tracking-widest hidden sm:flex">
                <span>COORD: X=10 Y=10</span>
                <span>STATUS: IDLE</span>
                <span>ENC: RSA-4096</span>
              </div>

              <motion.div
                initial={{ scale: 0.8, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="space-y-6 relative z-10"
              >
                <div className="w-20 h-20 border-2 border-[var(--color-neon-green)] rounded-full flex items-center justify-center mx-auto neon-glow-green">
                  <Play size={40} className="text-[var(--color-neon-green)] ml-1" />
                </div>
                <h2 className="text-4xl font-bold tracking-tighter text-white">READY?</h2>
                <div className="space-y-2">
                  <p className="text-slate-400 max-w-[240px] mx-auto text-sm">
                    Connect to the grid. Consume data nodes.
                  </p>
                  
                  {/* Difficulty Selector */}
                  <div className="flex gap-2 justify-center py-2">
                    {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((level) => (
                      <button
                        key={level}
                        onClick={() => { playSound('UI'); setDifficulty(level); }}
                        className={`px-3 py-1 text-[10px] font-mono border transition-all ${
                          difficulty === level 
                            ? 'bg-[var(--color-neon-green)] text-black border-[var(--color-neon-green)] shadow-[0_0_10px_rgba(57,255,20,0.4)]' 
                            : 'bg-transparent text-slate-500 border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>

                  <p className="text-[10px] text-[var(--color-neon-green)] font-mono uppercase tracking-[0.2em]">
                    Use Arrows or WASD
                  </p>
                </div>
                <button
                  onClick={resetGame}
                  className="px-8 py-3 bg-[var(--color-neon-green)] text-black font-bold uppercase tracking-widest rounded-sm hover:opacity-90 active:scale-95 transition-all shadow-[0_0_15px_rgba(57,255,20,0.5)]"
                >
                  INITIALIZE
                </button>
              </motion.div>
            </motion.div>
          )}

          {countdown !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.5 }}
              key={countdown}
              className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
            >
              <span className="text-8xl font-black italic text-[var(--color-neon-green)] neon-text-green">
                {countdown > 0 ? countdown : 'GO!'}
              </span>
            </motion.div>
          )}

          {isGameOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 bg-red-950/80 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 border-4 border-red-500/30 overflow-hidden"
            >
              {/* Emergency Brackets */}
              <div className="absolute top-4 left-4 w-12 h-12 border-t-2 border-l-2 border-red-500 opacity-60" />
              <div className="absolute top-4 right-4 w-12 h-12 border-t-2 border-r-2 border-red-500 opacity-60" />
              <div className="absolute bottom-16 left-4 w-12 h-12 border-b-2 border-l-2 border-red-500 opacity-60" />
              <div className="absolute bottom-16 right-4 w-12 h-12 border-b-2 border-r-2 border-red-500 opacity-60" />

              {/* Red Data Detail */}
              <div className="absolute top-10 w-full flex justify-center gap-12 text-[9px] font-mono text-red-500/60 uppercase tracking-[0.4em]">
                <span>MALFUNCTION DETECTED</span>
                <span>ACCESS: DENIED</span>
              </div>

              <motion.div
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: { opacity: 0 },
                  visible: {
                    opacity: 1,
                    transition: { staggerChildren: 0.15, delayChildren: 0.2 }
                  }
                }}
                className="w-full max-w-sm flex flex-col items-center gap-8 mt-12"
              >
                {/* Score Board - Split Alignment */}
                <motion.div 
                  variants={{
                    hidden: { opacity: 0, scale: 0.95 },
                    visible: { opacity: 1, scale: 1 }
                  }}
                  className="w-full bg-black/40 border border-red-500/20 rounded p-10 space-y-8 shadow-[inset_0_0_20px_rgba(239,68,68,0.1)]"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-red-500 font-mono text-xs uppercase font-bold tracking-[0.3em]">Score</span>
                    <span className="text-3xl font-mono text-white font-bold">{score.toString().padStart(6, '0')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#a16207] font-mono text-xs uppercase font-bold tracking-[0.3em]">Highest Score</span>
                    <span className="text-2xl font-mono text-white font-bold opacity-70">{highScore.toString().padStart(6, '0')}</span>
                  </div>
                </motion.div>
                
                <motion.div 
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 }
                  }}
                  className="w-full space-y-6"
                >
                  {/* Difficulty Selector in Game Over */}
                  <div className="flex flex-col gap-3">
                    <p className="text-[9px] text-[#7f1d1d] font-mono uppercase font-bold tracking-[0.3em]">Adjust Protocol Level</p>
                    <div className="flex gap-2 justify-center">
                      {(Object.keys(DIFFICULTY_SETTINGS) as Difficulty[]).map((level) => (
                        <button
                          key={level}
                          onClick={() => { playSound('UI'); setDifficulty(level); }}
                          className={`px-4 py-2 text-[10px] font-mono border transition-all ${
                            difficulty === level 
                              ? 'bg-red-600 text-white border-red-600 shadow-[0_0_15px_rgba(239,68,68,0.5)]' 
                              : 'bg-transparent text-red-500/30 border-red-950/40 hover:border-red-500/40'
                          }`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </motion.div>

              {/* Wide Footer Button */}
              <motion.div
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="absolute bottom-6 left-6 right-6"
              >
                <button
                  onClick={resetGame}
                  className="w-full flex items-center justify-center gap-4 py-6 bg-red-600 text-white font-black uppercase tracking-[0.3em] hover:bg-red-500 active:scale-95 transition-all shadow-[0_0_30px_rgba(239,68,68,0.3)]"
                >
                  <RotateCcw size={24} />
                  Reset System
                </button>
              </motion.div>
            </motion.div>
          )}

          {isPaused && !isGameOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 bg-slate-950/60 backdrop-blur-sm flex flex-col items-center justify-center"
            >
              <div className="text-center space-y-4">
                <Pause size={48} className="text-white mx-auto animate-pulse" />
                <h2 className="text-3xl font-bold tracking-tighter text-white uppercase italic">SUSPENDED</h2>
                <p className="text-slate-400 font-mono text-xs uppercase">Press Space to Resume</p>
                <button
                   onClick={() => { playSound('UI'); setIsPaused(false); }}
                   className="px-6 py-2 border border-white text-white font-bold uppercase tracking-widest hover:bg-white hover:text-black transition-all"
                >
                  RESUME
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Controls & Footer */}
      <div className="w-full max-w-md mt-8 grid grid-cols-1 md:grid-cols-2 gap-8 items-end">
        {/* Mobile Controls */}
        <div className="flex flex-col items-center gap-2">
          <button 
            className="w-16 h-16 flex items-center justify-center bg-slate-900 border border-slate-700 rounded-xl active:bg-slate-800 active:neon-glow-green transition-all"
            onMouseDown={() => { playSound('UI'); handleDirectionBtn({ x: 0, y: -1 }); }}
            onTouchStart={(e) => { e.preventDefault(); playSound('UI'); handleDirectionBtn({ x: 0, y: -1 }); }}
          >
            <ChevronUp size={32} />
          </button>
          <div className="flex gap-2">
            <button 
              className="w-16 h-16 flex items-center justify-center bg-slate-900 border border-slate-700 rounded-xl active:bg-slate-800 active:neon-glow-green transition-all"
              onMouseDown={() => { playSound('UI'); handleDirectionBtn({ x: -1, y: 0 }); }}
              onTouchStart={(e) => { e.preventDefault(); playSound('UI'); handleDirectionBtn({ x: -1, y: 0 }); }}
            >
              <ChevronLeft size={32} />
            </button>
            <button 
              className="w-16 h-16 flex items-center justify-center bg-slate-900 border border-slate-700 rounded-xl active:bg-slate-800 active:neon-glow-green transition-all"
              onMouseDown={() => { playSound('UI'); handleDirectionBtn({ x: 0, y: 1 }); }}
              onTouchStart={(e) => { e.preventDefault(); playSound('UI'); handleDirectionBtn({ x: 0, y: 1 }); }}
            >
              <ChevronDown size={32} />
            </button>
            <button 
              className="w-16 h-16 flex items-center justify-center bg-slate-900 border border-slate-700 rounded-xl active:bg-slate-800 active:neon-glow-green transition-all"
              onMouseDown={() => { playSound('UI'); handleDirectionBtn({ x: 1, y: 0 }); }}
              onTouchStart={(e) => { e.preventDefault(); playSound('UI'); handleDirectionBtn({ x: 1, y: 0 }); }}
            >
              <ChevronRight size={32} />
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="hidden md:flex flex-col gap-2 font-mono text-[10px] text-slate-500 text-right uppercase">
          <div className="flex justify-between border-b border-slate-800 pb-1">
            <span>Movement</span>
            <span className="text-slate-300">ARROWS / WASD</span>
          </div>
          <div className="flex justify-between border-b border-slate-800 pb-1">
            <span>Pause / Start</span>
            <span className="text-slate-300">SPACE</span>
          </div>
          <div className="flex justify-between border-b border-slate-800 pb-1">
            <span>System Status</span>
            <span className="text-emerald-500">OPERATIONAL</span>
          </div>
          <div className="flex justify-between">
            <span>Latency</span>
            <span className="text-slate-300">12MS</span>
          </div>
        </div>
      </div>
      
      {/* Footer Decoration */}
      <div className="fixed bottom-4 right-4 flex gap-2 pointer-events-none opacity-20">
        <div className="w-1 h-32 bg-slate-800"></div>
        <div className="w-16 h-32 border border-slate-800 rounded-tr-3xl"></div>
      </div>
    </div>
  );
}
