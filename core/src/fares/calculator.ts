// Port of fares/calculator.py: dispatch from the segment's carrier to its calculator.
import { ValueError } from "../pyCompat";
import { estimate as biletGraniczny } from "./biletGranicznyZasiekiForst";
import { estimate as bvg } from "./bvgBerlin";
import { estimateKrakow, estimatePoznan, estimateWarszawa } from "./cityTimed";
import { estimate as db } from "./db";
import { estimate as flixbus } from "./flixbus";
import { estimate as hvv } from "./hvv";
import { estimate as international } from "./international";
import { estimate as kd } from "./kdZgorzelecGorlitz";
import { estimate as kolejeMalopolskie } from "./kolejeMalopolskie";
import { estimate as kolejeMazowieckie } from "./kolejeMazowieckie";
import { estimate as lka } from "./lkaLodz";
import { Carrier, type PriceEstimate, type Segment } from "./model";
import { estimate as mpkWroclaw } from "./mpkWroclaw";
import { estimate as mvv } from "./mvv";
import { estimate as pkp } from "./pkp";
import { estimate as polregio } from "./polregio";
import { estimate as skm } from "./skmTrojmiasto";
import { estimate as vrr } from "./vrr";
import { estimate as vrs } from "./vrsKoln";
import { estimate as ztmLublin } from "./ztmLublin";
import { estimate as zvon } from "./zvonGorlitz";

const CALCULATORS: Record<Carrier, (segment: Segment) => PriceEstimate> = {
  [Carrier.PKP_INTERCITY]: pkp,
  [Carrier.DB]: db,
  [Carrier.VRR]: vrr,
  [Carrier.FLIXBUS]: flixbus,
  [Carrier.ZTM_LUBLIN]: ztmLublin,
  [Carrier.ZTM_WARSZAWA]: estimateWarszawa,
  [Carrier.MPK_KRAKOW]: estimateKrakow,
  [Carrier.ZTM_POZNAN]: estimatePoznan,
  [Carrier.MPK_WROCLAW]: mpkWroclaw,
  [Carrier.BVG_BERLIN]: bvg,
  [Carrier.HVV]: hvv,
  [Carrier.MVV]: mvv,
  [Carrier.VRS_KOLN]: vrs,
  [Carrier.POLREGIO_PODSTAWOWA]: (s) => polregio(s),
  [Carrier.SKM_TROJMIASTO]: (s) => skm(s),
  [Carrier.LKA_LODZ]: lka,
  [Carrier.KOLEJE_MALOPOLSKIE]: (s) => kolejeMalopolskie(s),
  [Carrier.KOLEJE_MAZOWIECKIE]: (s) => kolejeMazowieckie(s),
  [Carrier.ZVON_GORLITZ]: zvon,
  [Carrier.KD_ZGORZELEC_GORLITZ]: kd,
  [Carrier.BILET_GRANICZNY_ZASIEKI_FORST]: biletGraniczny,
  [Carrier.INTERNATIONAL_PL_DE]: international,
};

export function estimatePrice(segment: Segment): PriceEstimate {
  const calc = Object.hasOwn(CALCULATORS, segment.carrier) ? CALCULATORS[segment.carrier] : undefined;
  if (!calc) throw new ValueError(`brak kalkulatora dla przewoźnika: ${segment.carrier}`);
  return calc(segment);
}
