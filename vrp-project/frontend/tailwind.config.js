/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                neon: {
                    purple: '#a855f7',
                    purple2: '#9333ea',
                    blue: '#818cf8',
                    cyan: '#22d3ee',
                    green: '#4ade80',
                    orange: '#fb923c',
                    red: '#f87171',
                },
                dark: {
                    950: '#020617',
                    900: '#0f172a',
                    850: '#111827',
                    800: '#1e293b',
                    700: '#1e3a5f',
                }
            },
            boxShadow: {
                'neon-purple': '0 0 15px rgba(168, 85, 247, 0.35), 0 0 30px rgba(168, 85, 247, 0.15)',
                'neon-purple-lg': '0 0 25px rgba(168, 85, 247, 0.5), 0 0 50px rgba(168, 85, 247, 0.25)',
                'neon-blue': '0 0 15px rgba(129, 140, 248, 0.35)',
                'neon-cyan': '0 0 15px rgba(34, 211, 238, 0.35)',
                'neon-green': '0 0 15px rgba(74, 222, 128, 0.35)',
                'card': '0 4px 24px rgba(0,0,0,0.6)',
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'glow': 'glow 2s ease-in-out infinite alternate',
                'scan': 'scan 3s linear infinite',
                'fade-in': 'fadeIn 0.5s ease forwards',
            },
            keyframes: {
                glow: {
                    '0%': { boxShadow: '0 0 10px rgba(168,85,247,0.3)' },
                    '100%': { boxShadow: '0 0 25px rgba(168,85,247,0.7), 0 0 50px rgba(168,85,247,0.3)' }
                },
                fadeIn: {
                    '0%': { opacity: '0', transform: 'translateY(8px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                }
            },
            fontFamily: {
                mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
                sans: ['Inter', 'system-ui', 'sans-serif'],
            }
        },
    },
    plugins: [],
}
