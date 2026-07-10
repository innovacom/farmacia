/**
 * anthropic.js — Cliente Anthropic compartido + modelo centralizado.
 *
 * Antes cada módulo (parser.pdf, matcher.ia, buscador.web) instanciaba su propio
 * cliente y hardcodeaba el modelo. Aquí se centraliza para poder cambiar de modelo
 * desde una sola variable de entorno y reutilizar la conexión.
 */
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Modelo por defecto para tareas de extracción/clasificación. Override con ANTHROPIC_MODEL.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

module.exports = { client, MODEL };
