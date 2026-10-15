const UNIDADES = ['', 'Un', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez',
  'Once', 'Doce', 'Trece', 'Catorce', 'Quince', 'Dieciseis', 'Diecisiete', 'Dieciocho', 'Diecinueve',
  'Veinte', 'Veintiun', 'Veintidos', 'Veintitres', 'Veinticuatro', 'Veinticinco', 'Veintiseis',
  'Veintisiete', 'Veintiocho', 'Veintinueve'];
const DECENAS = ['', '', '', 'Treinta', 'Cuarenta', 'Cincuenta', 'Sesenta', 'Setenta', 'Ochenta', 'Noventa'];
const CENTENAS = ['', 'Ciento', 'Doscientos', 'Trescientos', 'Cuatrocientos', 'Quinientos',
  'Seiscientos', 'Setecientos', 'Ochocientos', 'Novecientos'];

function menorMil(n) {
  if (n === 100) return 'Cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 30) partes.push(UNIDADES[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      partes.push(u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d]);
    }
  }
  return partes.join(' ');
}

function enteroALetra(n) {
  if (n === 0) return 'Cero';
  const millones = Math.floor(n / 1e6);
  const miles = Math.floor((n % 1e6) / 1e3);
  const resto = n % 1e3;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'Un Millon' : `${enteroALetra(millones)} Millones`);
  if (miles) partes.push(miles === 1 ? 'Mil' : `${menorMil(miles)} Mil`);
  if (resto) partes.push(menorMil(resto));
  return partes.join(' ');
}

/** 103116.75 → "Ciento Tres Mil Ciento Dieciseis Pesos 75/100 M.N." */
function importeEnLetra(total, moneda = 'MXN') {
  const cents = Math.round(Number(total || 0) * 100);
  const entero = Math.floor(cents / 100);
  const dec = String(cents % 100).padStart(2, '0');
  const nombre = moneda === 'USD' ? 'Dolares' : 'Pesos';
  const sufijo = moneda === 'USD' ? 'USD' : 'M.N.';
  const letra = enteroALetra(entero);
  return `${letra} ${entero === 1 ? nombre.replace(/s$/, '') : nombre} ${dec}/100 ${sufijo}`;
}

module.exports = { importeEnLetra };
