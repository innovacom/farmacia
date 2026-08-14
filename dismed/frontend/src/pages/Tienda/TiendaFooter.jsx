// Pie de página del catálogo público — identidad de la empresa (logo, lema,
// redes) + tarjeta por sucursal publicada (dirección, teléfono, horario y
// mapa). Colocado en pages/Tienda/ y no en components/shared/ porque
// depende de la paleta `tienda-*` y las fuentes `font-tienda*`, que existen
// solo para Catalogo.jsx/DetalleProducto.jsx (ver tailwind.config.js).
import { Link } from 'react-router-dom';
import { Facebook, Instagram, Mail, Phone, MapPin, Clock, MessageCircle, Truck, CreditCard, ShieldCheck } from 'lucide-react';
import { linkWhatsApp } from '../../utils/whatsapp';
import BoletinForm from './BoletinForm';

const ABREV = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' };
const hm = (t) => (t || '').slice(0, 5); // TIME 'HH:MM:SS' → 'HH:MM'

// Un día SIN filas es "sin información", no "cerrado" (misma semántica que
// pos.controller.js#listHorariosSucursal y el chatbot de WhatsApp): se omite
// del listado en vez de inventar un cierre que nadie configuró. Días
// contiguos con idéntico horario se funden en un renglón
// ("Lun a Vie 09:00–20:00"); varias filas por día (turno partido) se
// concatenan ("09:00–14:00, 16:00–20:00").
function resumirHorarios(filas = []) {
  const porDia = new Map();
  for (const f of filas) {
    if (!porDia.has(f.dia_semana)) porDia.set(f.dia_semana, []);
    porDia.get(f.dia_semana).push(f);
  }
  const firma = (d) => {
    const fs = porDia.get(d);
    if (!fs) return null; // sin información
    if (fs.every((f) => f.cerrado)) return 'Cerrado';
    return fs.filter((f) => !f.cerrado && f.hora_inicio && f.hora_fin)
      .map((f) => `${hm(f.hora_inicio)}–${hm(f.hora_fin)}`).join(', ') || null;
  };
  const out = [];
  for (let d = 1; d <= 7; d++) {
    const t = firma(d);
    if (!t) continue;
    const ult = out[out.length - 1];
    // Sólo se funden días CONSECUTIVOS: si el martes no tiene información,
    // "Lun a Mié" sería falso.
    if (ult && ult.texto === t && ult.hasta === d - 1) ult.hasta = d;
    else out.push({ desde: d, hasta: d, texto: t });
  }
  return out.map((r) => ({
    dias: r.desde === r.hasta ? ABREV[r.desde]
      : r.hasta === r.desde + 1 ? `${ABREV[r.desde]} y ${ABREV[r.hasta]}`
        : `${ABREV[r.desde]} a ${ABREV[r.hasta]}`,
    texto: r.texto,
  }));
}

function RedesSociales({ info }) {
  const items = [
    info.redes?.facebook && { Icon: Facebook, href: info.redes.facebook, label: 'Facebook' },
    info.redes?.instagram && { Icon: Instagram, href: info.redes.instagram, label: 'Instagram' },
    info.redes?.email && { Icon: Mail, href: `mailto:${info.redes.email}`, label: 'Correo' },
    info.whatsapp && { Icon: MessageCircle, href: linkWhatsApp(info.whatsapp, 'Hola, quiero más información.'), label: 'WhatsApp' },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="flex items-center gap-2 mt-4">
      {items.map(({ Icon, href, label }) => (
        <a
          key={label} href={href} target="_blank" rel="noopener noreferrer" title={label}
          className="flex items-center justify-center w-9 h-9 rounded-full ring-1 ring-tienda-ink/10
                     text-tienda-muted hover:bg-tienda-tealsoft hover:text-tienda-teal transition-colors"
        >
          <Icon size={16} />
        </a>
      ))}
    </div>
  );
}

function TarjetaSucursal({ s }) {
  const telLimpio = (s.telefono || '').replace(/\D/g, '');
  const horarios = resumirHorarios(s.horarios);
  return (
    <div>
      <p className="font-tienda-display font-bold text-tienda-ink">{s.nombre}</p>
      {s.direccion && (
        <p className="flex items-start gap-1.5 text-sm text-tienda-muted mt-1.5">
          <MapPin size={14} className="mt-0.5 shrink-0" /> {s.direccion}
        </p>
      )}
      {s.telefono && (
        <a href={telLimpio ? `tel:${telLimpio}` : undefined}
          className="flex items-center gap-1.5 text-sm text-tienda-muted mt-1 hover:text-tienda-teal">
          <Phone size={14} className="shrink-0" /> {s.telefono}
        </a>
      )}
      {horarios.length > 0 && (
        <div className="flex items-start gap-1.5 text-sm text-tienda-muted mt-1">
          <Clock size={14} className="mt-0.5 shrink-0" />
          <div>
            {horarios.map((h) => (
              <p key={h.dias} className="tabular-nums">
                <span className="font-medium text-tienda-ink/80">{h.dias}</span> {h.texto}
              </p>
            ))}
          </div>
        </div>
      )}
      {s.mapa_embed_url && (
        <iframe
          src={s.mapa_embed_url}
          className="w-full aspect-video rounded-xl border border-tienda-ink/10 mt-3"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
          title={`Mapa de ${s.nombre}`}
        />
      )}
      {(s.responsable_sanitario || s.licencia_sanitaria) && (
        <p className="text-[11px] text-tienda-muted/80 mt-2">
          {s.responsable_sanitario && (
            <>Responsable sanitario: {s.responsable_sanitario}{s.cedula_responsable_sanitario ? ` (Céd. ${s.cedula_responsable_sanitario})` : ''}</>
          )}
          {s.responsable_sanitario && s.licencia_sanitaria && ' · '}
          {s.licencia_sanitaria && <>Aviso de Funcionamiento COFEPRIS: {s.licencia_sanitaria}</>}
        </p>
      )}
    </div>
  );
}

// Envíos/pagos (texto) y los links legales (solo si hay contenido real detrás
// — nunca se linkea a una página vacía, mismo principio que RedesSociales).
function LegalAyuda({ legal }) {
  if (!legal) return null;
  const links = [
    legal.privacidad_disponible && { to: '/tienda/privacidad', label: 'Aviso de privacidad' },
    legal.terminos_disponible && { to: '/tienda/terminos', label: 'Términos y condiciones' },
  ].filter(Boolean);
  if (!legal.politica_envios && !legal.formas_pago && !links.length) return null;

  return (
    <div>
      <h2 className="font-tienda-display font-bold text-tienda-ink text-sm uppercase tracking-wide mb-3">
        Legal y ayuda
      </h2>
      {legal.politica_envios && (
        <p className="flex items-start gap-1.5 text-sm text-tienda-muted mb-2">
          <Truck size={14} className="mt-0.5 shrink-0" /> {legal.politica_envios}
        </p>
      )}
      {legal.formas_pago && (
        <p className="flex items-start gap-1.5 text-sm text-tienda-muted mb-2">
          <CreditCard size={14} className="mt-0.5 shrink-0" /> {legal.formas_pago}
        </p>
      )}
      {links.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-3">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="text-sm text-tienda-teal hover:underline">
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Ancho relativo de cada columna según cuántas de las 3 (identidad siempre,
// sucursales, legal) tienen contenido — nunca se fuerza una columna vacía
// (mismo principio que el fix del hueco con 1 sola sucursal).
const GRID_POR_COLUMNAS = {
  1: '',
  2: 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]',
  3: 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]',
};

export default function TiendaFooter({ info }) {
  if (!info) return null;
  const sucursales = info.sucursales || [];
  const hayLegal = !!(info.legal?.politica_envios || info.legal?.formas_pago
    || info.legal?.privacidad_disponible || info.legal?.terminos_disponible);
  const nCols = 1 + (sucursales.length > 0 ? 1 : 0) + (hayLegal ? 1 : 0);

  return (
    <footer className="border-t border-tienda-ink/10 bg-white mt-14">
      <div className={`max-w-6xl mx-auto px-4 py-10 grid gap-10 ${GRID_POR_COLUMNAS[nCols]}`}>
        <div>
          {info.logo_url && (
            <img src={info.logo_url} alt={info.nombre} className="h-10 object-contain mb-3" />
          )}
          <p className="font-tienda-display font-extrabold text-tienda-ink">{info.nombre}</p>
          {info.lema && <p className="text-sm text-tienda-muted mt-1">{info.lema}</p>}
          <RedesSociales info={info} />
        </div>

        {sucursales.length > 0 && (
          <div>
            <h2 className="sr-only">Sucursales</h2>
            {/* Con 1 sola sucursal (el caso más común) sm:grid-cols-2 dejaría
                una celda vacía a la derecha del mapa; sin forzar columnas, la
                tarjeta ocupa el ancho completo y se acota con max-w-sm para
                que el mapa no crezca desproporcionado. */}
            <div className={`grid gap-6 ${sucursales.length > 1 ? 'sm:grid-cols-2' : 'max-w-sm'}`}>
              {sucursales.map((s) => <TarjetaSucursal key={s.id} s={s} />)}
            </div>
          </div>
        )}

        <LegalAyuda legal={info.legal} />
      </div>

      <div className="border-t border-tienda-ink/5 py-8">
        <BoletinForm />
      </div>

      <div className="border-t border-tienda-ink/5">
        <div className="max-w-6xl mx-auto px-4 py-4">
          {info.legal?.leyenda_medicamentos && (
            <p className="flex items-start gap-1.5 text-[11px] text-tienda-muted/80 mb-1.5">
              <ShieldCheck size={13} className="mt-0.5 shrink-0" /> {info.legal.leyenda_medicamentos}
            </p>
          )}
          <p className="text-xs text-tienda-muted">
            © {new Date().getFullYear()} {info.razon_social || info.nombre}
          </p>
        </div>
      </div>
    </footer>
  );
}
