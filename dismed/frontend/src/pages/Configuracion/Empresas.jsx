import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { Building2, Plus, Pencil, UploadCloud, RotateCcw, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Modal from '../../components/ui/Modal';
import { escalaBrand } from '../../hooks/useBranding';

const DEFAULT_PRIMARIO = '#1a6bb5'; // azul INNOVACOM (default del sistema)

/**
 * Configuración multi-empresa (admin): datos fiscales, identidad visual
 * (logos, colores, tema) y parámetros POS por tenant.
 * Nota: el CFDI se timbra con el perfil Facturama global (un RFC por cuenta);
 * los datos fiscales por empresa quedan listos para el multiemisor futuro.
 */
export default function Empresas() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(null); // null | {} | empresa

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  });

  const cerrarYRefrescar = () => {
    qc.invalidateQueries({ queryKey: ['empresas'] });
    qc.invalidateQueries({ queryKey: ['mi-branding'] });
    setEditando(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Building2 size={22} className="text-brand-500" />
          <h1 className="text-2xl font-bold text-gray-900">Empresas</h1>
        </div>
        <button className="btn-primary" onClick={() => setEditando({})}>
          <Plus size={16} /> Nueva empresa
        </button>
      </div>

      <p className="text-sm text-gray-500 mb-4 max-w-2xl">
        Cada empresa (farmacia propia o cliente) tiene su propio branding: logo, colores
        y parámetros del punto de venta. Los usuarios asignados a una empresa solo ven
        los datos de esa empresa en el POS.
      </p>

      {isLoading ? (
        <p className="text-gray-400">Cargando…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {empresas.map((e) => (
            <div key={e.id} className="card">
              <div className="flex items-start gap-3">
                {e.logo_path ? (
                  <img
                    src={`/uploads/branding/${e.logo_path}`}
                    alt={e.nombre}
                    className="w-12 h-12 object-contain rounded-lg border border-gray-100"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold"
                    style={{ backgroundColor: e.color_primario || DEFAULT_PRIMARIO }}
                  >
                    {e.nombre?.[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {e.nombre_comercial || e.nombre}
                    {!e.activo && <span className="badge-gray ml-2">Inactiva</span>}
                  </p>
                  <p className="text-xs text-gray-400 font-mono">{e.rfc || 'Sin RFC'}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {e.sucursales} sucursal(es) · {e.usuarios} usuario(s)
                  </p>
                </div>
                <button
                  className="p-1.5 text-gray-400 hover:text-brand-500 rounded-lg"
                  onClick={() => setEditando(e)}
                  title="Editar"
                >
                  <Pencil size={15} />
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <span
                  className="w-5 h-5 rounded-full border border-gray-200"
                  style={{ backgroundColor: e.color_primario || DEFAULT_PRIMARIO }}
                  title="Color primario"
                />
                {e.color_secundario && (
                  <span
                    className="w-5 h-5 rounded-full border border-gray-200"
                    style={{ backgroundColor: e.color_secundario }}
                    title="Color secundario"
                  />
                )}
                <span className="text-xs text-gray-400 ml-1">Tema {e.tema}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {editando !== null && (
        <EditorEmpresa
          empresa={editando.id ? editando : null}
          onClose={() => setEditando(null)}
          onSaved={cerrarYRefrescar}
        />
      )}
    </div>
  );
}

function EditorEmpresa({ empresa, onClose, onSaved }) {
  const [form, setForm] = useState({
    nombre: empresa?.nombre || '',
    nombre_comercial: empresa?.nombre_comercial || '',
    rfc: empresa?.rfc || '',
    regimen_fiscal: empresa?.regimen_fiscal || '',
    codigo_postal: empresa?.codigo_postal || '',
    color_primario: empresa?.color_primario || DEFAULT_PRIMARIO,
    color_secundario: empresa?.color_secundario || '',
    tema: empresa?.tema || 'claro',
    activo: empresa ? !!empresa.activo : true,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = useMutation({
    mutationFn: async () => {
      const body = { ...form, color_secundario: form.color_secundario || null, activo: form.activo ? 1 : 0 };
      if (empresa) return api.put(`/empresas/${empresa.id}`, body);
      const r = await api.post('/empresas', body);
      return r;
    },
    onSuccess: () => { toast.success('Empresa guardada'); onSaved(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar'),
  });

  return (
    <Modal title={empresa ? `Editar — ${empresa.nombre}` : 'Nueva empresa'} onClose={onClose} size="xl">
      <div className="space-y-6">
        {/* 1. Datos fiscales */}
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Datos fiscales</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Razón social</label>
              <input className="input" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} />
            </div>
            <div>
              <label className="label">Nombre comercial</label>
              <input className="input" value={form.nombre_comercial} onChange={(e) => set('nombre_comercial', e.target.value)} />
            </div>
            <div>
              <label className="label">RFC</label>
              <input className="input font-mono" maxLength={13} value={form.rfc}
                onChange={(e) => set('rfc', e.target.value.toUpperCase())} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Régimen fiscal</label>
                <input className="input" maxLength={3} placeholder="601" value={form.regimen_fiscal}
                  onChange={(e) => set('regimen_fiscal', e.target.value)} />
              </div>
              <div>
                <label className="label">C.P.</label>
                <input className="input" maxLength={5} value={form.codigo_postal}
                  onChange={(e) => set('codigo_postal', e.target.value)} />
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            El timbrado CFDI usa hoy el perfil global del sistema (un RFC por cuenta del PAC);
            estos datos quedan listos para el timbrado por empresa en una fase posterior.
          </p>
        </section>

        {/* 2. Identidad visual */}
        <section className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Identidad visual</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Color primario</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.color_primario}
                      onChange={(e) => set('color_primario', e.target.value)}
                      className="w-10 h-9 rounded cursor-pointer border border-gray-200" />
                    <input className="input font-mono" value={form.color_primario}
                      onChange={(e) => set('color_primario', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label">Color secundario (opcional)</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.color_secundario || '#888888'}
                      onChange={(e) => set('color_secundario', e.target.value)}
                      className="w-10 h-9 rounded cursor-pointer border border-gray-200" />
                    <input className="input font-mono" value={form.color_secundario}
                      placeholder="—" onChange={(e) => set('color_secundario', e.target.value)} />
                  </div>
                </div>
              </div>
              <div>
                <label className="label">Tema</label>
                <div className="flex gap-2">
                  <button type="button"
                    className={form.tema === 'claro' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                    onClick={() => set('tema', 'claro')}>
                    Claro
                  </button>
                  <button type="button" className="btn-secondary btn-sm opacity-50 cursor-not-allowed" disabled
                    title="Próximamente">
                    Oscuro (próximamente)
                  </button>
                </div>
              </div>
              <button type="button" className="btn-secondary btn-sm"
                onClick={() => { set('color_primario', DEFAULT_PRIMARIO); set('color_secundario', ''); }}>
                <RotateCcw size={13} /> Restablecer a DISMED
              </button>
              {empresa && <SubirLogos empresa={empresa} />}
              {!empresa && (
                <p className="text-xs text-gray-400">
                  Guarda la empresa primero para poder subir sus logos.
                </p>
              )}
            </div>

            <VistaPrevia form={form} empresa={empresa} />
          </div>
        </section>

        {/* 3. Parámetros POS */}
        {empresa && <ParametrosPos empresaId={empresa.id} />}

        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          {empresa ? (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.activo} onChange={(e) => set('activo', e.target.checked)} />
              Empresa activa
            </label>
          ) : <span />}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary"
              disabled={guardar.isPending || !form.nombre.trim()}
              onClick={() => guardar.mutate()}>
              Guardar
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Mini-mockup (sidebar + botón + ticket) pintado con los colores elegidos. */
function VistaPrevia({ form, empresa }) {
  const escala = escalaBrand(/^#[0-9a-fA-F]{6}$/.test(form.color_primario)
    ? form.color_primario : DEFAULT_PRIMARIO);
  const c500 = `rgb(${escala[500]})`;
  const c50 = `rgb(${escala[50]})`;
  const nombre = form.nombre_comercial || form.nombre || 'Mi Farmacia';
  const logoUrl = empresa?.logo_path ? `/uploads/branding/${empresa.logo_path}` : null;

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Vista previa</p>
      <div className="flex gap-3">
        {/* Sidebar */}
        <div className="bg-white rounded-lg border border-gray-200 p-2.5 w-36 shrink-0">
          <div className="flex items-center gap-1.5 mb-2">
            {logoUrl
              ? <img src={logoUrl} alt="" className="w-6 h-6 object-contain" />
              : <div className="w-6 h-6 rounded flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ backgroundColor: c500 }}>{nombre[0]?.toUpperCase()}</div>}
            <span className="text-[10px] font-bold text-gray-900 truncate">{nombre}</span>
          </div>
          <div className="rounded px-1.5 py-1 text-[10px] font-medium mb-1"
            style={{ backgroundColor: c50, color: c500 }}>
            ● Venta mostrador
          </div>
          <div className="px-1.5 py-1 text-[10px] text-gray-500">Caja y turnos</div>
          <div className="px-1.5 py-1 text-[10px] text-gray-500">Bitácora</div>
        </div>
        {/* Botón + ticket */}
        <div className="flex-1 space-y-2">
          <button type="button" className="w-full rounded-lg text-white text-xs font-semibold py-2"
            style={{ backgroundColor: c500 }}>
            <Store size={12} className="inline mr-1" /> Cobrar
          </button>
          <div className="bg-white border border-gray-200 rounded p-2 text-center">
            {logoUrl && <img src={logoUrl} alt="" className="h-6 mx-auto object-contain mb-1" />}
            <p className="text-[10px] font-bold" style={{ color: c500 }}>{nombre}</p>
            <p className="text-[8px] text-gray-400">TICKET POS-2026-0001</p>
            <div className="border-t border-dashed border-gray-200 my-1" />
            <p className="text-[8px] text-gray-500 text-left">1 × Paracetamol 500mg …… $35.00</p>
            <p className="text-[9px] font-bold text-right mt-0.5">TOTAL $35.00</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubirLogos({ empresa }) {
  const qc = useQueryClient();
  return (
    <div className="grid grid-cols-2 gap-2">
      <DropLogo empresa={empresa} tipo="principal" label="Logo principal"
        onDone={() => { qc.invalidateQueries({ queryKey: ['empresas'] }); qc.invalidateQueries({ queryKey: ['mi-branding'] }); }} />
      <DropLogo empresa={empresa} tipo="ticket" label="Logo para ticket (B/N)"
        onDone={() => { qc.invalidateQueries({ queryKey: ['empresas'] }); qc.invalidateQueries({ queryKey: ['mi-branding'] }); }} />
    </div>
  );
}

function DropLogo({ empresa, tipo, label, onDone }) {
  const subir = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('archivo', file);
      return api.post(`/empresas/${empresa.id}/logo?tipo=${tipo}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => { toast.success(`${label} actualizado`); onDone(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al subir el logo'),
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/png': [], 'image/jpeg': [], 'image/webp': [] },
    maxFiles: 1,
    maxSize: 2 * 1024 * 1024,
    onDrop: (files) => files[0] && subir.mutate(files[0]),
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors
        ${isDragActive ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}
    >
      <input {...getInputProps()} />
      <UploadCloud size={16} className="mx-auto text-gray-400 mb-1" />
      <p className="text-xs text-gray-600">{subir.isPending ? 'Subiendo…' : label}</p>
      <p className="text-[10px] text-gray-400">PNG/JPG/WEBP · máx 2 MB</p>
    </div>
  );
}

function ParametrosPos({ empresaId }) {
  const qc = useQueryClient();
  const [valores, setValores] = useState({});

  const { data: config } = useQuery({
    queryKey: ['empresa-config', empresaId],
    queryFn: () => api.get(`/empresas/${empresaId}/config`).then((r) => r.data),
  });

  useEffect(() => {
    if (config) {
      setValores(Object.fromEntries(Object.entries(config).map(([k, v]) => [k, v.valor])));
    }
  }, [config]);

  const guardar = useMutation({
    mutationFn: () => api.put(`/empresas/${empresaId}/config`, valores),
    onSuccess: () => {
      toast.success('Parámetros guardados');
      qc.invalidateQueries({ queryKey: ['empresa-config', empresaId] });
      qc.invalidateQueries({ queryKey: ['mi-branding'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error al guardar parámetros'),
  });

  if (!config) return null;
  const set = (k, v) => setValores((s) => ({ ...s, [k]: v }));

  return (
    <section className="border-t border-gray-100 pt-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Parámetros del punto de venta</h3>
      <div className="grid md:grid-cols-2 gap-3">
        {Object.entries(config).map(([clave, meta]) => (
          <div key={clave}>
            <label className="label">{meta.label}</label>
            {meta.valores ? (
              <select className="input" value={valores[clave] ?? meta.valor}
                onChange={(e) => set(clave, e.target.value)}>
                {meta.valores.map((v) => (
                  <option key={v} value={v}>
                    {formatoOpcion(clave, v)}
                  </option>
                ))}
              </select>
            ) : (
              <input className="input" value={valores[clave] ?? meta.valor}
                onChange={(e) => set(clave, e.target.value)} />
            )}
          </div>
        ))}
      </div>
      <button className="btn-secondary btn-sm mt-3" disabled={guardar.isPending}
        onClick={() => guardar.mutate()}>
        Guardar parámetros
      </button>
    </section>
  );
}

function formatoOpcion(clave, v) {
  if (clave === 'ticket_ancho_mm') return `${v} mm`;
  if (clave === 'global_periodicidad_default') return v === '01' ? 'Diaria (01)' : 'Mensual (04)';
  if (v === '1') return 'Sí';
  if (v === '0') return 'No';
  return v;
}
