import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  Upload, FileSpreadsheet, FileText, Keyboard,
  Loader2, CheckCircle, Trash2, Plus, AlertTriangle, X, UserPlus, Link2, Pencil,
} from 'lucide-react';
import api from '../../services/api';
import ProductoPicker from '../../components/shared/ProductoPicker';
import Modal from '../../components/ui/Modal';

export default function NuevaSolicitud() {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm();

  const clienteIdSel = watch('cliente_id');
  const [picker, setPicker]               = useState(null); // { idx }
  const [modo, setModo]                   = useState('excel');
  const [parsedPartidas, setParsedPartidas] = useState([]);
  const [parsing, setParsing]             = useState(false);
  const [parseInfo, setParseInfo]         = useState(null);
  const [parseMeta, setParseMeta]         = useState(null);
  const [saving, setSaving]               = useState(false);
  const [clienteNoEncontrado, setClienteNoEncontrado] = useState(null);
  const [showClienteModal, setShowClienteModal]       = useState(false);
  const [creandoCliente, setCreandoCliente]           = useState(false);

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes', 'activos'],
    queryFn: () => api.get('/clientes?activos=1').then((r) => r.data),
  });

  // ── Pre-llenar campos desde meta del Excel ──────────────────────────────
  useEffect(() => {
    if (!parseMeta) return;
    if (parseMeta.coc)             setValue('referencia_cliente', String(parseMeta.coc));
    if (parseMeta.atencion)        setValue('atencion', String(parseMeta.atencion));
    if (parseMeta.concepto)        setValue('concepto', String(parseMeta.concepto));
    if (parseMeta.factor_ganancia) setValue('factor_ganancia', parseMeta.factor_ganancia);

    if (parseMeta.cliente_nombre) {
      if (!clientes.length) return; // esperar que cargue la lista
      const needle = parseMeta.cliente_nombre.toLowerCase();
      const match  = clientes.find((c) =>
        c.razon_social.toLowerCase().includes(needle) ||
        needle.includes(c.razon_social.toLowerCase())
      );
      if (match) {
        setValue('cliente_id', String(match.id));
        setClienteNoEncontrado(null);
      } else {
        setClienteNoEncontrado(parseMeta.cliente_nombre);
      }
    }
  }, [parseMeta, clientes]);

  // ── Crear cliente rápido desde el modal ────────────────────────────────
  async function crearClienteRapido(e) {
    e.preventDefault();
    const fd    = new FormData(e.target);
    const datos = Object.fromEntries(fd.entries());
    if (!datos.razon_social) return;
    setCreandoCliente(true);
    try {
      const { data } = await api.post('/clientes', {
        razon_social:    datos.razon_social,
        rfc:             datos.rfc || null,
        tipo_cliente:    'otro',
        direccion_fiscal: datos.direccion_fiscal || null,
      });
      // Opcional: crear contacto si se anotó responsable
      if (datos.responsable && data.id) {
        await api.post(`/clientes/${data.id}/contactos`, {
          nombre: datos.responsable, es_principal: 1,
        });
      }
      await qc.invalidateQueries(['clientes']);
      setValue('cliente_id', String(data.id));
      setClienteNoEncontrado(null);
      setShowClienteModal(false);
      toast.success(`Cliente "${datos.razon_social}" creado`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al crear cliente');
    } finally {
      setCreandoCliente(false);
    }
  }

  // ── Drag & drop ─────────────────────────────────────────────────────────
  const onDrop = useCallback(async (files) => {
    const file = files[0];
    if (!file) return;
    setParsing(true);
    setParsedPartidas([]);
    setParseInfo(null);
    setParseMeta(null);
    setClienteNoEncontrado(null);
    try {
      const form = new FormData();
      form.append('archivo', file);
      const endpoint = modo === 'excel' ? '/solicitudes/parse-excel' : '/solicitudes/parse-pdf';
      const res = await api.post(endpoint, form, { headers: { 'Content-Type': 'multipart/form-data' } });

      const meta = res.data.meta || {};
      setParseMeta(meta);

      const partidas = (res.data.partidas || [])
        .sort((a, b) => (Number(a.linea) || 0) - (Number(b.linea) || 0))
        .map((p) => ({ ...p, linea: Number(p.linea), _key: `${p.linea}_${Math.random()}` }));

      setParsedPartidas(partidas);
      setParseInfo({
        total:       partidas.length,
        sin_precio:  partidas.filter((p) => p.observaciones === 'NO COTIZO').length,
        con_precio:  partidas.filter((p) => Object.keys(p.precios_proveedores || {}).length > 0).length,
        proveedores: (res.data.proveedores || []).map((p) => p.nombre),
        archivo:     file.name,
        meta,
      });
      toast.success(`${partidas.length} partidas extraídas de "${file.name}"`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al procesar el archivo');
    } finally {
      setParsing(false);
    }
  }, [modo]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: modo === 'excel'
      ? { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [],
          'application/vnd.ms-excel': [], 'text/csv': [] }
      : { 'application/pdf': [] },
    maxFiles: 1,
  });

  // ── Edición de tabla ────────────────────────────────────────────────────
  function updatePartida(idx, field, val) {
    setParsedPartidas((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  }
  function removePartida(idx) {
    setParsedPartidas((prev) => prev.filter((_, i) => i !== idx));
  }
  function addManualPartida() {
    const maxLinea = parsedPartidas.reduce((m, p) => Math.max(m, Number(p.linea) || 0), 0);
    setParsedPartidas((prev) => [
      ...prev,
      { _key: Date.now(), linea: maxLinea + 1, codigo_cliente: '',
        codigo_gobierno: '', descripcion_original: '',
        cantidad: 1, unidad_medida: 'pza', observaciones: '',
        iva_exento: 0, precios_proveedores: {} },
    ]);
  }

  // ── Guardar ─────────────────────────────────────────────────────────────
  async function onSubmit(formData) {
    if (!parsedPartidas.length) { toast.error('Agrega al menos una partida'); return; }

    // Los campos numéricos se capturan como texto; aquí se convierten y validan.
    const partidasLimpias = parsedPartidas.map((p) => ({
      ...p,
      linea:    parseInt(String(p.linea).trim(), 10),
      cantidad: parseFloat(String(p.cantidad).trim().replace(',', '.')),
    }));

    const invalidas = partidasLimpias.filter(
      (p) => !Number.isFinite(p.linea) || p.linea <= 0 ||
             !Number.isFinite(p.cantidad) || p.cantidad <= 0
    );
    if (invalidas.length > 0) {
      toast.error(`Revisa número de partida y cantidad (deben ser mayores a 0) en ${invalidas.length} renglón(es)`);
      return;
    }

    // Validar duplicados
    const lineas = partidasLimpias.map((p) => p.linea);
    const duplicados = lineas.filter((l, i) => lineas.indexOf(l) !== i);
    if (duplicados.length > 0) {
      toast.error(`Números de partida duplicados: ${[...new Set(duplicados)].join(', ')}`);
      return;
    }

    // Reestructurar precios: de { partida.precios_proveedores } → { proveedor: [{linea,precio,comentario}] }
    const precios_proveedores = {};
    for (const p of partidasLimpias) {
      if (!p.precios_proveedores) continue;
      for (const [prov, data] of Object.entries(p.precios_proveedores)) {
        if (!precios_proveedores[prov]) precios_proveedores[prov] = [];
        precios_proveedores[prov].push({
          linea:      p.linea,
          precio:     data.precio     || 0,
          comentario: data.comentario || '',
        });
      }
    }

    setSaving(true);
    try {
      const { data: sol } = await api.post('/solicitudes', {
        cliente_id:         parseInt(formData.cliente_id),
        referencia_cliente: formData.referencia_cliente,
        atencion:           formData.atencion || null,
        concepto:           formData.concepto || null,
        factor_ganancia:    parseFloat(formData.factor_ganancia) || null,
        tipo_origen:        modo,
        notas:              formData.notas,
      });

      await api.post(`/solicitudes/${sol.id}/partidas/bulk`, {
        partidas:            partidasLimpias,
        tipo_origen:         modo,
        archivo_origen:      parseInfo?.archivo || null,
        precios_proveedores, // ← aquí van los precios del Excel
      });

      toast.success(`Solicitud ${sol.folio} creada — ${partidasLimpias.length} partidas, ${Object.keys(precios_proveedores).length} proveedores`);
      // Sin ningún precio de proveedor (>0) → disparar búsqueda automática en internet
      const sinPrecios = !Object.values(precios_proveedores)
        .some((arr) => arr.some((x) => parseFloat(x.precio) > 0));
      navigate(`/solicitudes/${sol.id}${sinPrecios ? '?buscarWeb=1' : ''}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  const noCotizo = parsedPartidas.filter((p) => p.observaciones === 'NO COTIZO').length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Nueva solicitud</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {/* ── Datos generales ── */}
        <div className="card grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="label">Cliente *</label>
            <select className="input" {...register('cliente_id', { required: 'Selecciona un cliente' })}>
              <option value="">— Selecciona —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.razon_social}</option>
              ))}
            </select>
            {errors.cliente_id && <p className="text-xs text-red-500 mt-1">{errors.cliente_id.message}</p>}

            {/* Aviso de cliente no encontrado */}
            {clienteNoEncontrado && (
              <div className="mt-2 flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                <span className="text-amber-800">
                  &quot;{clienteNoEncontrado}&quot; no está registrado.
                </span>
                <button
                  type="button"
                  onClick={() => setShowClienteModal(true)}
                  className="ml-auto flex items-center gap-1 text-brand-600 font-medium hover:underline whitespace-nowrap"
                >
                  <UserPlus size={12} /> Dar de alta
                </button>
              </div>
            )}
          </div>
          <div>
            <label className="label">COC — N° pedido del cliente</label>
            <input className="input" placeholder="REQ-2025-001 ó 125"
              {...register('referencia_cliente')} />
          </div>
          <div>
            <label className="label">Factor de ganancia</label>
            <input type="number" step="0.01" min="0" max="10"
              className="input" placeholder="0.15"
              {...register('factor_ganancia')} />
            <p className="text-xs text-gray-400 mt-0.5">Ej: 0.15 = 15%</p>
          </div>
          <div className="md:col-span-2">
            <label className="label">Atención — dirigir a</label>
            <input className="input" placeholder="Lic. María González"
              {...register('atencion')} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Concepto</label>
            <input className="input" placeholder="INSUMOS MÉDICOS Y MATERIAL DE CURACIÓN"
              {...register('concepto')} />
          </div>
          <div className="md:col-span-4">
            <label className="label">Notas internas</label>
            <input className="input" placeholder="Urgente, entrega en 48h…" {...register('notas')} />
          </div>
        </div>

        {/* ── Selector de modo ── */}
        <div className="card">
          <p className="label mb-3">Origen de las partidas</p>
          <div className="flex gap-3">
            {[
              { key: 'excel',  label: 'Excel / CSV', icon: FileSpreadsheet },
              { key: 'pdf',    label: 'PDF (IA)',     icon: FileText },
              { key: 'manual', label: 'Manual',       icon: Keyboard },
            ].map(({ key, label, icon: Icon }) => (
              <button key={key} type="button"
                onClick={() => { setModo(key); setParsedPartidas([]); setParseInfo(null); setParseMeta(null); setClienteNoEncontrado(null); }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors
                            ${modo === key
                              ? 'border-brand-500 bg-brand-50 text-brand-500'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                <Icon size={16} />{label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Zona de carga ── */}
        {(modo === 'excel' || modo === 'pdf') && (
          <div className="card">
            <div {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
                          ${isDragActive ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-brand-300'}`}
            >
              <input {...getInputProps()} />
              {parsing ? (
                <div className="flex flex-col items-center gap-3 text-brand-500">
                  <Loader2 size={36} className="animate-spin" />
                  <p className="font-medium">{modo === 'pdf' ? 'Analizando PDF con IA…' : 'Procesando Excel…'}</p>
                  {modo === 'pdf' && <p className="text-xs text-gray-400">Puede tardar 10-20 segundos</p>}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-gray-400">
                  <Upload size={36} />
                  <p className="font-medium text-gray-600">
                    {isDragActive ? 'Suelta el archivo aquí' : 'Arrastra o haz clic para seleccionar'}
                  </p>
                  <p className="text-xs">
                    {modo === 'excel' ? 'Soporta .xlsx, .xls, .csv' : 'Soporta .pdf — Se usará IA para extraer partidas'}
                  </p>
                </div>
              )}
            </div>

            {parseInfo && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-3 text-sm bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
                  <CheckCircle size={16} className="text-green-600 shrink-0" />
                  <span className="text-green-800">
                    <strong>{parseInfo.total} partidas</strong> extraídas
                    {parseInfo.proveedores?.length > 0 && (
                      <> · <strong>{parseInfo.proveedores.length} proveedores</strong> con precios importados: {parseInfo.proveedores.slice(0, 4).join(', ')}{parseInfo.proveedores.length > 4 ? `… y ${parseInfo.proveedores.length - 4} más` : ''}</>
                    )}
                  </span>
                </div>
                {parseInfo.sin_precio > 0 && (
                  <div className="flex items-center gap-3 text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                    <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                    <span className="text-amber-800">
                      <strong>{parseInfo.sin_precio} partidas</strong> sin precio de ningún proveedor — marcadas &quot;NO COTIZO&quot;
                    </span>
                  </div>
                )}
                {parseInfo.meta?.cliente_nombre && (
                  <p className="text-xs text-gray-500 px-1">
                    Detectado — Cliente: <strong>{parseInfo.meta.cliente_nombre}</strong>
                    {parseInfo.meta.coc ? <> · COC: <strong>{parseInfo.meta.coc}</strong></> : ''}
                    {parseInfo.meta.factor_ganancia > 0 ? <> · Factor: <strong>{parseInfo.meta.factor_ganancia}</strong></> : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Tabla editable ── */}
        {(parsedPartidas.length > 0 || modo === 'manual') && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800">
                Partidas ({parsedPartidas.length})
                {noCotizo > 0 && <span className="ml-2 text-xs text-amber-600 font-normal">· {noCotizo} sin precio</span>}
                {(() => {
                  const sinVinc = parsedPartidas.filter((p) => !p.producto_id).length;
                  return sinVinc > 0
                    ? <span className="ml-2 text-xs text-gray-400 font-normal">· {sinVinc} sin vincular al catálogo</span>
                    : null;
                })()}
              </h2>
              <button type="button" onClick={addManualPartida} className="btn-secondary btn-sm">
                <Plus size={14}/> Agregar partida
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="table-auto w-full text-xs">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>Part.#</th>
                    <th style={{ width: 110 }}>Cód. cliente</th>
                    <th style={{ width: 100 }}>Cód. gobierno</th>
                    <th>Descripción *</th>
                    <th style={{ width: 130 }} title="Vincula con tu catálogo (opcional)">Producto catálogo</th>
                    <th style={{ width: 70 }}>Cant.</th>
                    <th style={{ width: 80 }}>U/M</th>
                    <th style={{ width: 50 }} title="Marca para calcular IVA (16%)">IVA</th>
                    <th style={{ width: 160 }}>Observaciones</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {parsedPartidas.map((p, idx) => (
                    <tr key={p._key} className={p.observaciones === 'NO COTIZO' ? 'bg-amber-50' : ''}>
                      <td>
                        <input type="text" inputMode="numeric" className="input text-xs text-center font-mono"
                          value={p.linea ?? ''}
                          onChange={(e) => updatePartida(idx, 'linea', e.target.value)} />
                      </td>
                      <td>
                        <input className="input text-xs" value={p.codigo_cliente || ''}
                          onChange={(e) => updatePartida(idx, 'codigo_cliente', e.target.value)}
                          placeholder="HRN-0042" />
                      </td>
                      <td>
                        <input className="input text-xs" value={p.codigo_gobierno || ''}
                          onChange={(e) => updatePartida(idx, 'codigo_gobierno', e.target.value)}
                          placeholder="Clave gov." />
                      </td>
                      <td>
                        <input className="input text-xs" value={p.descripcion_original || ''}
                          onChange={(e) => updatePartida(idx, 'descripcion_original', e.target.value)}
                          placeholder="Descripción del producto" required />
                      </td>
                      <td>
                        {p.producto_id ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[11px] text-green-600 truncate" title={p.sku_interno || ''}>
                              {p.sku_interno || '✓'}
                            </span>
                            <button type="button" title="Cambiar"
                              onClick={() => setPicker({ idx })}
                              className="text-gray-300 hover:text-brand-500"><Pencil size={12} /></button>
                            <button type="button" title="Quitar vínculo"
                              onClick={() => { updatePartida(idx, 'producto_id', null); updatePartida(idx, 'sku_interno', null); }}
                              className="text-gray-300 hover:text-red-500"><X size={12} /></button>
                          </div>
                        ) : (
                          <button type="button"
                            onClick={() => setPicker({ idx })}
                            className="text-xs text-brand-500 hover:underline flex items-center gap-1">
                            <Link2 size={12} /> Vincular
                          </button>
                        )}
                      </td>
                      <td>
                        <input type="text" inputMode="decimal" className="input text-xs text-right" value={p.cantidad ?? ''}
                          onChange={(e) => updatePartida(idx, 'cantidad', e.target.value)} />
                      </td>
                      <td>
                        <input className="input text-xs" value={p.unidad_medida || ''}
                          onChange={(e) => updatePartida(idx, 'unidad_medida', e.target.value)}
                          placeholder="pza" />
                      </td>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-500 cursor-pointer"
                          checked={!p.iva_exento}
                          onChange={(e) => updatePartida(idx, 'iva_exento', e.target.checked ? 0 : 1)}
                          title={!p.iva_exento ? 'Sí calcula IVA (16%)' : 'Exento — no calcula IVA'} />
                      </td>
                      <td>
                        <input
                          className={`input text-xs ${p.observaciones === 'NO COTIZO' ? 'text-amber-700 font-medium' : ''}`}
                          value={p.observaciones || ''}
                          onChange={(e) => updatePartida(idx, 'observaciones', e.target.value)}
                          placeholder="Marca, especificación…" />
                      </td>
                      <td>
                        <button type="button" onClick={() => removePartida(idx)}
                          className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 size={14}/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Botones ── */}
        <div className="flex gap-3">
          <button type="submit" disabled={saving || !parsedPartidas.length} className="btn-primary">
            {saving && <Loader2 size={16} className="animate-spin"/>}
            {saving ? 'Guardando…' : 'Crear solicitud'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">Cancelar</button>
        </div>

      </form>

      {/* ── Modal alta rápida de cliente ── */}
      {showClienteModal && (
        <Modal
          size="sm"
          title={`Dar de alta: ${clienteNoEncontrado || 'Nuevo cliente'}`}
          onClose={() => setShowClienteModal(false)}
        >
          <form onSubmit={crearClienteRapido} className="space-y-4">
            <div>
              <label className="label">Razón social *</label>
              <input className="input" name="razon_social"
                defaultValue={clienteNoEncontrado || ''} required />
            </div>
            <div>
              <label className="label">Responsable / Contacto</label>
              <input className="input" name="responsable" placeholder="Lic. María González" />
            </div>
            <div>
              <label className="label">RFC <span className="text-gray-400 font-normal">(opcional)</span></label>
              <input className="input uppercase" name="rfc" placeholder="XAXX010101000" />
            </div>
            <div>
              <label className="label">Dirección <span className="text-gray-400 font-normal">(opcional)</span></label>
              <textarea className="input min-h-[60px]" name="direccion_fiscal"
                placeholder="Calle, colonia, ciudad…" />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={creandoCliente} className="btn-primary">
                {creandoCliente ? <Loader2 size={15} className="animate-spin"/> : <UserPlus size={15}/>}
                {creandoCliente ? 'Creando…' : 'Crear y seleccionar'}
              </button>
              <button type="button" onClick={() => setShowClienteModal(false)} className="btn-secondary">
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Selector de producto del catálogo ── */}
      {picker && (
        <ProductoPicker
          open
          onClose={() => setPicker(null)}
          partida={parsedPartidas[picker.idx]}
          clienteId={clienteIdSel || null}
          onSelect={(c) => {
            updatePartida(picker.idx, 'producto_id', c.id);
            updatePartida(picker.idx, 'sku_interno', c.sku_interno);
            updatePartida(picker.idx, 'match_score', c.score != null ? Number((c.score / 100).toFixed(3)) : null);
          }}
        />
      )}
    </div>
  );
}
