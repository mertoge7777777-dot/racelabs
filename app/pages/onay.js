import { register, page, go, toast } from '../core/router.js';
import { KVKK_VERSION } from '../config.js';
import { sb, q, S, loadContext, errMsg } from '../core/supabase.js';
import { esc } from '../core/format.js';

export async function onay() {
  page('', '<div class="auth"><div class="card" style="width:min(560px,100%)"><div class="k">KVKK</div><h2>Kişisel verilerin işlenmesi</h2>'
    + '<p class="small">RaceLab; antrenman, test ve yarış simülasyonu sonuçlarınızı (süreler, nabız, yük, beden ölçüleri) salonunuzun antrenörlerinin performansınızı takip etmesi ve size program önerebilmesi için işler. Video saklanmaz. Verileriniz AB (Frankfurt) bölgesindeki sunucularda tutulur. Verilerinizin silinmesini veya dışa aktarılmasını salonunuzdan isteyebilirsiniz.</p>'
    + '<p class="note">Bu metin taslaktır; yayından önce hukuk danışmanı tarafından onaylanmalıdır (sürüm ' + esc(KVKK_VERSION) + ').</p>'
    + '<label class="row" style="margin:12px 0;color:var(--tx)"><input type="checkbox" id="c1" style="width:22px;min-height:22px"> Aydınlatma metnini okudum.</label>'
    + '<label class="row" style="margin:12px 0;color:var(--tx)"><input type="checkbox" id="c2" style="width:22px;min-height:22px"> Sağlık ve performans verilerimin bu amaçla işlenmesine açık rıza veriyorum.</label>'
    + '<button class="btn p" id="cb" style="width:100%" disabled>Onayla ve devam et</button><p class="small mut" style="margin-top:10px"><a href="#" id="lo">Çıkış yap</a></p></div></div>', { bare: true });
  const c1 = document.getElementById('c1'), c2 = document.getElementById('c2'), cb = document.getElementById('cb');
  const upd = () => (cb.disabled = !(c1.checked && c2.checked)); c1.onchange = upd; c2.onchange = upd;
  cb.onclick = async () => { try { await q(sb.from('consents').insert([{ kind: 'kvkk_aydinlatma', text_version: KVKK_VERSION }, { kind: 'kvkk_acik_riza_saglik', text_version: KVKK_VERSION }])); await loadContext(); go(S.org ? 'pano' : 'salon'); } catch (e) { toast(errMsg(e), true); } };
  document.getElementById('lo').onclick = async (ev) => { ev.preventDefault(); await sb.auth.signOut(); S.user = null; go('giris'); };
}
register('onay', onay);
