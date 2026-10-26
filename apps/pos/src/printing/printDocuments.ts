import { buildDeliveryOrder, buildReceipt, STORE_ADDRESS, type Order } from "@yf/core";
import { currentCompany } from "../place";
import { printer, printHtml } from "./printer";
import { renderDeliveryOrderHtml } from "./renderDeliveryOrderHtml";

function contractorFromOrder(order: Order): { name: string; tin?: string; address?: string; phone?: string } | undefined {
  const name = order.contractorName?.trim();
  if (!name) return undefined;
  return {
    name,
    tin: order.contractorTin,
    address: order.contractorAddress,
    phone: order.contractorPhone,
  };
}

/** Print the thermal receipt from the values stored on the order. */
export async function printOrderReceipt(order: Order): Promise<void> {
  const contractor = contractorFromOrder(order);
  await printer.print(
    buildReceipt(order, {
      storeName: currentCompany.value.name,
      storeAddress: STORE_ADDRESS,
      ...(contractor ? { contractor } : {}),
    }),
  );
}

/** Print the A4 delivery order from the values stored on the order. */
export async function printDeliveryOrder(order: Order): Promise<void> {
  const model = buildDeliveryOrder(order, {
    company: {
      name: currentCompany.value.name,
      address: STORE_ADDRESS,
    },
  });
  await printHtml(renderDeliveryOrderHtml(model));
}
