export default function JarvisOrb() {
  return (
    <div className="relative flex select-none items-center justify-center" aria-hidden="true">
      <svg
        viewBox="0 0 340 280"
        className="h-auto w-64 max-w-full sm:w-72 motion-reduce:[&_*]:animate-none"
        style={{ filter: 'drop-shadow(0 0 35px rgba(59, 130, 246, 0.15))' }}
      >
        <defs>
          <filter id="soft-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="voice-glow-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
            <stop offset="45%" stopColor="#2563eb" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient vocal speech glow */}
        <circle
          cx="170"
          cy="140"
          r="95"
          fill="url(#voice-glow-grad)"
          className="animate-speech-glow"
        />

        {/* Vocal Soundwave Expanding Rings (Radiating when speaking) */}
        <circle
          cx="170"
          cy="140"
          r="10"
          fill="none"
          stroke="#38bdf8"
          className="animate-speech-soundwave-1"
        />
        <circle
          cx="170"
          cy="140"
          r="10"
          fill="none"
          stroke="#60a5fa"
          className="animate-speech-soundwave-2"
        />

        {/* Scattered ambient stars / pluses around the perimeter */}
        <g className="font-mono text-[9px] fill-blue-400/40 select-none">
          <text x="32" y="55" opacity="0.3">+</text>
          <text x="50" y="88" opacity="0.4">.</text>
          <text x="18" y="115" opacity="0.25">+</text>
          <text x="80" y="140" opacity="0.3">+</text>
          <text x="65" y="180" opacity="0.35">.</text>
          <text x="35" y="215" opacity="0.2">+</text>

          <text x="110" y="42" opacity="0.25">.</text>
          <text x="210" y="48" opacity="0.3">+</text>
          <text x="235" y="65" opacity="0.35">.</text>
          <text x="290" y="70" opacity="0.25">.</text>
          <text x="310" y="85" opacity="0.3">+</text>

          <text x="270" y="125" opacity="0.35">+</text>
          <text x="300" y="150" opacity="0.2">.</text>
          <text x="280" y="195" opacity="0.3">.</text>
          <text x="120" y="245" opacity="0.25">.</text>
        </g>

        {/* Dark rectangular circuit blocks */}
        <g fill="#141c28" stroke="#253549" strokeWidth="0.8" opacity="0.95">
          {/* Top block pair */}
          <rect x="148" y="66" width="14" height="11" rx="1.5" />
          <rect x="166" y="66" width="12" height="11" rx="1.5" />

          {/* Upper middle blocks */}
          <rect x="135" y="98" width="28" height="18" rx="1.5" />
          <rect x="175" y="98" width="30" height="12" rx="1.5" />
          <rect x="168" y="118" width="22" height="12" rx="1.5" />

          {/* Lower middle blocks */}
          <rect x="135" y="166" width="22" height="11" rx="1.5" />
          <rect x="166" y="166" width="28" height="11" rx="1.5" />
          <rect x="180" y="184" width="28" height="12" rx="1.5" />

          {/* Bottom block pair */}
          <rect x="148" y="206" width="14" height="18" rx="1.5" />
          <rect x="166" y="206" width="12" height="18" rx="1.5" />
        </g>

        {/* Central Vocal Hero Blocks (Animated voice waveform bars) */}
        <g className="animate-speech-wave-left">
          <rect
            x="85"
            y="132"
            width="60"
            height="24"
            rx="2"
            fill="#121e2c"
            stroke="#294666"
            strokeWidth="1"
          />
          <rect x="78" y="139" width="7" height="10" rx="1" fill="#121e2c" stroke="#294666" strokeWidth="0.8" />
          {/* Inside Audio EQ lines */}
          <rect x="100" y="140" width="3" height="8" rx="1" fill="#60a5fa" className="animate-eq-1" />
          <rect x="110" y="138" width="3" height="12" rx="1" fill="#38bdf8" className="animate-eq-2" />
          <rect x="120" y="139" width="3" height="10" rx="1" fill="#93c5fd" className="animate-eq-3" />
          <rect x="130" y="141" width="3" height="6" rx="1" fill="#60a5fa" className="animate-eq-1" />
        </g>

        <g className="animate-speech-wave-right">
          <rect
            x="185"
            y="132"
            width="60"
            height="24"
            rx="2"
            fill="#121e2c"
            stroke="#294666"
            strokeWidth="1"
          />
          <rect x="245" y="139" width="7" height="10" rx="1" fill="#121e2c" stroke="#294666" strokeWidth="0.8" />
          {/* Inside Audio EQ lines */}
          <rect x="195" y="141" width="3" height="6" rx="1" fill="#60a5fa" className="animate-eq-3" />
          <rect x="205" y="139" width="3" height="10" rx="1" fill="#93c5fd" className="animate-eq-2" />
          <rect x="215" y="138" width="3" height="12" rx="1" fill="#38bdf8" className="animate-eq-1" />
          <rect x="225" y="140" width="3" height="8" rx="1" fill="#60a5fa" className="animate-eq-2" />
        </g>

        {/* Center Vocal Diamond (Pulses with vocal energy) */}
        <g className="animate-speech-core" filter="url(#soft-glow)">
          <path
            d="M 170 138 L 175 144 L 170 150 L 165 144 Z"
            fill="#38bdf8"
            fillOpacity="0.25"
            stroke="#93c5fd"
            strokeWidth="1.3"
          />
          <circle cx="170" cy="144" r="1.5" fill="#ffffff" />
        </g>

        {/* ASCII Dot Matrix & Plus rows matching AgentOS design with vocal flutter */}
        <g className="font-mono text-[9px] font-semibold tracking-[2.5px] select-none">
          {/* Upper rows */}
          <g className="animate-speech-harmonic">
            <text x="132" y="62" fill="#60a5fa" opacity="0.85">•••••••</text>
            <text x="185" y="62" fill="#bae6fd" opacity="0.95">+++++</text>

            <text x="114" y="75" fill="#38bdf8" opacity="0.8">•••••</text>
            <text x="188" y="75" fill="#e0f2fe" opacity="0.9">+++••</text>

            <text x="105" y="88" fill="#60a5fa" opacity="0.7">••••</text>
            <text x="195" y="88" fill="#e0f2fe" opacity="0.85">•••••</text>
          </g>

          <g className="animate-speech-harmonic-alt">
            <text x="96" y="101" fill="#bae6fd" opacity="0.9">++++++++</text>
            <text x="210" y="101" fill="#93c5fd" opacity="0.75">••</text>

            <text x="88" y="115" fill="#60a5fa" opacity="0.85">•••••••••</text>
            <text x="215" y="115" fill="#bae6fd" opacity="0.8">••</text>

            <text x="84" y="128" fill="#38bdf8" opacity="0.7">•••••</text>
            <text x="220" y="128" fill="#e0f2fe" opacity="0.85">••</text>
          </g>

          {/* Center level indicators */}
          <text x="68" y="146" fill="#93c5fd" opacity="0.85">••</text>
          <text x="256" y="146" fill="#93c5fd" opacity="0.85">••</text>

          {/* Lower rows */}
          <g className="animate-speech-harmonic">
            <text x="74" y="162" fill="#38bdf8" opacity="0.7">••••</text>
            <text x="248" y="162" fill="#e0f2fe" opacity="0.85">•••</text>

            <text x="82" y="177" fill="#60a5fa" opacity="0.8">•••••••••</text>
            <text x="224" y="177" fill="#93c5fd" opacity="0.85">••••</text>
          </g>

          <g className="animate-speech-harmonic-alt">
            <text x="88" y="191" fill="#bae6fd" opacity="0.95">++++++++++++++++++</text>
            <text x="222" y="191" fill="#60a5fa" opacity="0.85">•••</text>

            <text x="106" y="204" fill="#38bdf8" opacity="0.75">••••</text>
            <text x="206" y="204" fill="#bae6fd" opacity="0.85">••••</text>

            <text x="118" y="218" fill="#e0f2fe" opacity="0.85">•••••</text>
            <text x="195" y="218" fill="#60a5fa" opacity="0.8">••••</text>

            <text x="130" y="230" fill="#60a5fa" opacity="0.75">•••••••••••••</text>
          </g>
        </g>
      </svg>
    </div>
  );
}
