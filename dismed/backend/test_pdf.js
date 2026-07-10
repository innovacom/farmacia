require('dotenv').config();
const { generarPdfCotizacion } = require('./src/modules/cotizaciones/cliente/pdf.generator');

const cotizacionPrueba = {
  folio: 'COT-2026-0042',
  dias_vigencia: 30,

  cliente_razon_social: 'HOSPITAL GENERAL DE MEXICO',
  contacto_nombre: 'LIC. MARÍA GONZÁLEZ',
  concepto: 'INSUMOS MÉDICOS Y MATERIAL DE CURACIÓN',
  coc: 'REQ-2026-4521',

  elaboro_nombre: 'ANGEL ZAMUDIO RIVERA',
  autoriza_nombre: 'RODRIGO RENE CABRERA GONZALEZ',
  representante_legal: 'RODRIGO CABRERA GONZALEZ',
  contacto_dudas_email: 'cotizaciones@innovacom.mx',
  contacto_dudas_tel: '55-5161-1095',

  partidas: [
    {
      descripcion: 'CATÉTER TIPO POWER PICC SHERLOCK DE POLIURETANO 5FR, 55CM DOBLE LUMEN (18G), CON TRES END CAPS, CINTA MÉTRICA 25", DISPOSITIVO ESTABILIZADOR Y TOALLITA PROTECTORA',
      cantidad: 80,
      unidad_medida: 'caja c/5',
      precio_unitario_venta: 31683.00,
      iva_exento: false,
      observaciones: 'BARD',
    },
    {
      descripcion: 'GASA HEMOSTATICA ABSORBENTE (SOLUBLE) DE 10CM x 5CM',
      cantidad: 50,
      unidad_medida: 'pieza',
      precio_unitario_venta: 153.40,
      iva_exento: false,
      observaciones: 'LIDES S-99',
    },
    {
      descripcion: 'GUANTES DE NITRILO SIN POLVO TALLA M, CAJA 100 PZAS',
      sku_interno: 'DM-00023',
      codigo_cliente: 'HGM-GL-NITR-M',
      cantidad: 50,
      unidad_medida: 'caja c/100',
      precio_unitario_venta: 185.34,
      iva_exento: false,
      observaciones: 'SUPERMAX O SIMILAR. SIN LÁTEX.',
    },
    {
      descripcion: 'APÓSITO TRANSPARENTE TEGADERM ADVANCE CON MARCO DE APLICACIÓN, BORDES REFORZADOS, TELA SUAVE, ETIQUETA DE REGISTRO Y DOS CINTAS ESTÉRILES',
      cantidad: 600,
      unidad_medida: 'caja c/50',
      precio_unitario_venta: 0,
      iva_exento: false,
      observaciones: 'NO COTIZO',
    },
    {
      descripcion: 'DESBRIDANTE ENZIMÁTICO COMPUESTO POR COLAGENASA (CLOSTRIDIOPEPTIDASA) Y CLORANFENICOL. TUBO CON 30 GR.',
      cantidad: 100,
      unidad_medida: 'pieza',
      precio_unitario_venta: 613.60,
      iva_exento: true,
      observaciones: 'ULCODERMA',
    },
    {
      descripcion: 'JERINGA HIPODÉRMICA 10ML C/AGUJA 21G x 1½", CAJA 100 PZAS',
      sku_interno: 'DM-00087',
      codigo_cliente: 'HGM-JER-10ML',
      cantidad: 30,
      unidad_medida: 'caja c/100',
      precio_unitario_venta: 132.50,
      iva_exento: false,
      observaciones: '',
    },
    {
      descripcion: 'CUBREBOCAS TRIPLE CAPA CON BANDA ELÁSTICA, CAJA 50 PZAS',
      sku_interno: 'DM-00041',
      codigo_cliente: 'HGM-MASK-3L',
      cantidad: 20,
      unidad_medida: 'caja c/50',
      precio_unitario_venta: 77.55,
      iva_exento: false,
      observaciones: 'COLOR AZUL. CERTIFICADO ASTM NIVEL 1.',
    },
  ],
};

(async () => {
  console.log('Generando PDF de prueba...');
  try {
    const result = await generarPdfCotizacion(cotizacionPrueba);
    console.log('\n✓ PDF generado:');
    console.log('  Archivo:', result.filename);
    console.log('  Ruta:   ', result.filePath);
  } catch (err) {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
  }
})();
