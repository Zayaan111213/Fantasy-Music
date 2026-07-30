/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,ts,jsx,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Ported verbatim from bandwagon/frontend/tailwind.config.js — the
      // vintage record-sleeve palette (harvest gold on espresso browns).
      // Keep these two files in sync if the palette changes.
      colors: {
        white: '#F3E7CE',
        indigo: {
          300: '#F0C766',
          400: '#E8B23A',
          500: '#D9A02C',
          600: '#C08A1E',
          700: '#A17417',
        },
        gray: {
          50: '#FBF5E6',
          100: '#F3E7CE',
          200: '#E4D6B4',
          300: '#D3BF9E',
          400: '#A88F70',
          500: '#7C6650',
          600: '#5F4936',
          700: '#43301F',
          800: '#2A1C12',
          900: '#241811',
          950: '#140D09',
        },
        red: {
          200: '#EFC0B0',
          300: '#E39A82',
          400: '#D5714F',
          500: '#C24A2E',
          600: '#A83E25',
          700: '#8C3420',
        },
        green: {
          300: '#8FBFAD',
          400: '#6FA595',
          500: '#4A7C6F',
          600: '#3E6A5E',
        },
        emerald: {
          400: '#6FA595',
          500: '#4A7C6F',
        },
        amber: {
          300: '#EFA36B',
          400: '#E07A3E',
          500: '#D06A30',
        },
        yellow: {
          300: '#EFA36B',
          400: '#E07A3E',
          500: '#D06A30',
          600: '#C25E28',
        },
        sky: {
          400: '#7FA0BF',
          500: '#5C82A6',
        },
        pink: {
          300: '#DFA9B8',
          400: '#D08CA0',
          500: '#C97B8E',
        },
        violet: {
          500: '#8E6FA8',
        },
        fuchsia: {
          500: '#C05B75',
        },
      },
    },
  },
  plugins: [],
};
