import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

const API = 'http://localhost:3100/api';
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = typeof localStorage === 'undefined' ? null : localStorage.getItem('support_token');
  return next(token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request);
};

@Component({
  selector: 'support-app', imports: [FormsModule], template: `
  @if (!token()) {
    <main class="login"><form (ngSubmit)="login()"><h1>Panel de soporte</h1><p>Suscripciones y cobranzas</p><label>Email<input type="email" name="email" [(ngModel)]="email" required></label><label>Contraseña<input type="password" name="password" [(ngModel)]="password" required></label><button [disabled]="loading()">Ingresar</button>@if(error()){<div class="error">{{error()}}</div>}</form></main>
  } @else {
    <header><div><strong>Facturación central</strong><small>Panel de soporte</small></div><nav><button (click)="section.set('charges')">Comprobantes</button><button (click)="section.set('adjustments')">Ajustes</button><button (click)="section.set('clients')">Clientes</button><button (click)="logout()">Salir</button></nav></header>
    <main class="shell">
      <section class="metrics"><article><span>Clientes</span><strong>{{dashboard()?.clients ?? '—'}}</strong></article><article><span>Comprobantes</span><strong>{{dashboard()?.pendingReceipts ?? '—'}}</strong></article><article><span>Ajustes pendientes</span><strong>{{dashboard()?.pendingAdjustments ?? '—'}}</strong></article><article><span>Datos incompletos</span><strong>{{dashboard()?.incomplete ?? '—'}}</strong></article></section>
      @if(section()==='charges'){<section><h2>Comprobantes por revisar</h2><div class="cards">@for(c of pendingCharges(); track c.id){<article class="card"><small>{{c.cliente.nombre}}</small><h3>{{c.concepto}}</h3><strong>{{money(c.importe)}}</strong><p>Vence {{date(c.fechaVencimiento)}}</p><div><button (click)="openReceipt(c.comprobantes[0]?.id)">Ver comprobante</button><button class="ok" (click)="confirm(c.id)">Confirmar pago</button><button class="danger" (click)="reject(c.id)">Rechazar</button></div></article>}@empty{<p>No hay comprobantes pendientes.</p>}</div></section>}
      @if(section()==='adjustments'){<section><h2>Actualizaciones por índice</h2><div class="cards">@for(a of adjustments();track a.id){<article class="card"><small>{{a.regla.plan.cliente.nombre}} · {{a.regla.indice.codigo}}</small><h3>{{a.regla.plan.nombre}}</h3><p>{{a.periodoDesde}} a {{a.periodoHasta}}</p><strong>{{money(a.precioAnterior)}} → {{a.precioPropuesto ? money(a.precioPropuesto) : 'Faltan datos'}}</strong><span class="status">{{a.estado}}</span>@if(a.estado==='PENDIENTE_APROBACION'){<button class="ok" (click)="approve(a.id)">Aprobar desde {{date(a.fechaEfectiva)}}</button>}</article>}@empty{<p>No hay ajustes calculados.</p>}</div></section>}
      @if(section()==='clients'){<section><h2>Clientes</h2><table><thead><tr><th>Cliente</th><th>Identificador</th><th>Estado</th></tr></thead><tbody>@for(c of clients();track c.id){<tr><td>{{c.nombre}}</td><td><code>{{c.identificador}}</code></td><td>{{c.activo?'Activo':'Inactivo'}}</td></tr>}</tbody></table></section>}
      @if(error()){<div class="error">{{error()}}</div>}
    </main>
  }`, changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  private http=inject(HttpClient); token=signal(typeof localStorage==='undefined'?null:localStorage.getItem('support_token')); loading=signal(false); error=signal<string|null>(null); section=signal<'charges'|'adjustments'|'clients'>('charges'); email='';password='';dashboard=signal<any>(null);charges=signal<any[]>([]);adjustments=signal<any[]>([]);clients=signal<any[]>([]);pendingCharges=computed(()=>this.charges().filter(c=>c.estado==='COMPROBANTE_ENVIADO'));
  constructor(){if(this.token())void this.load();}
  async login(){this.loading.set(true);this.error.set(null);try{const r:any=await firstValueFrom(this.http.post(`${API}/auth/login`,{email:this.email,password:this.password}));localStorage.setItem('support_token',r.accessToken);this.token.set(r.accessToken);await this.load();}catch{this.error.set('No se pudo iniciar sesión.');}finally{this.loading.set(false)}}
  logout(){localStorage.removeItem('support_token');this.token.set(null)}
  async load(){try{const [d,c,a,cl]:any=await Promise.all([firstValueFrom(this.http.get(`${API}/admin/dashboard`)),firstValueFrom(this.http.get(`${API}/admin/charges`)),firstValueFrom(this.http.get(`${API}/admin/adjustments`)),firstValueFrom(this.http.get(`${API}/admin/clients`))]);this.dashboard.set(d);this.charges.set(c);this.adjustments.set(a);this.clients.set(cl);}catch{this.error.set('No se pudieron cargar los datos.')}}
  async confirm(id:string){await firstValueFrom(this.http.patch(`${API}/admin/charges/${id}/confirm`,{}));await this.load()}
  async reject(id:string){const reason=prompt('Motivo del rechazo');if(!reason)return;await firstValueFrom(this.http.patch(`${API}/admin/charges/${id}/reject`,{reason}));await this.load()}
  async approve(id:string){await firstValueFrom(this.http.patch(`${API}/admin/adjustments/${id}/approve`,{}));await this.load()}
  async openReceipt(id:string|undefined){if(!id)return;const result:any=await firstValueFrom(this.http.get(`${API}/admin/receipts/${id}/url`));window.open(new URL(result.url,API).toString(),'_blank','noopener')}
  money(v:any){return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(v))} date(v:string){return new Intl.DateTimeFormat('es-AR').format(new Date(v))}
}
