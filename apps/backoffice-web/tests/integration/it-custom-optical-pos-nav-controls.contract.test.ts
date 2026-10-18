import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,it,expect} from "vitest";
import {POS_MENU_CATALOG,isCustomPosMenuVisible} from "../../src/lib/pos-menu-policy";
import {resolvePosMenuAvailability} from "../../src/lib/pos-menu-effective-state";
const read=(file:string)=>readFileSync(resolve(process.cwd(),"src",file),"utf8");
const options=(optical:boolean)=>{
  const keys={"main.optical_customers":true,"main.optical_work_orders":true};
  return resolvePosMenuAvailability({
    overrides:keys,is_custom:true,
    contract:{status:"active",ended_at:null,metadata:{sales_modes:{optical_retail:optical}}},
    plan:[],feature_overrides:[],active_branch_ids:["branch-a"]
  });
};
describe("IT controls two independent POS Optical first-class menus",()=>{
  it("recognizes both keys in IT shared catalog and main menu panel",()=>{
    const keys=POS_MENU_CATALOG.filter(x=>x.key.startsWith("main.optical_"));
    expect(keys.map(x=>x.key)).toEqual(["main.optical_customers","main.optical_work_orders"]);
    expect(keys.every(x=>x.group==="main")).toBe(true);
    expect(read("components/it-admin/tenant-pos-menu-policies.tsx")).toContain('item.group === "main"');
    expect(read("app/api/it-admin/v1/tenants/[tenantId]/pos-menu-policies/route.ts")).toContain('isValidPosMenuKey(key)');
  });
  it("requires CUSTOM Optical sales mode and explicit switches; neither toggles generic POS modules",()=>{
    const enabled=options(true);
    expect(enabled["main.optical_customers"]?.reason).toBe("available");
    expect(enabled["main.optical_work_orders"]?.reason).toBe("available");
    expect(options(false)["main.optical_customers"]?.reason).toBe("package");
    expect(options(false)["main.optical_work_orders"]?.reason).toBe("package");
    expect(isCustomPosMenuVisible("main.optical_customers",{},true)).toBe(false);
    expect(isCustomPosMenuVisible("main.optical_work_orders",{"main.optical_work_orders":true},true)).toBe(true);
    expect(POS_MENU_CATALOG.find(x=>x.key==="main.sales")?.route).toBe("/preview/pos");
  });
});
