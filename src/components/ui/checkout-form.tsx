"use client"

import React from "react"
import { CreditCard, MapPin, Tag } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function CheckoutForm({
  addressLine1,
  addressLine2,
  paymentMethod,
  paymentDetails,
  itemTotal,
  deliveryFee,
  taxes,
  orderTotal,
  onApplyPromo,
  onPlaceOrder,
  children
}: {
  addressLine1: string;
  addressLine2?: string;
  paymentMethod: string;
  paymentDetails: string;
  itemTotal: number;
  deliveryFee: number;
  taxes: number;
  orderTotal: number;
  onApplyPromo?: (code: string) => void;
  onPlaceOrder?: () => void;
  children?: React.ReactNode;
}) {
  const [promoCode, setPromoCode] = React.useState("");

  return (
    <div className="w-full flex flex-col items-center justify-center bg-transparent mt-8">
      <Card className="w-full shadow-md border-black/5 rounded-none bg-white font-sans text-ink">
        <CardHeader>
          <CardTitle className="text-[1.2rem] font-serif italic text-ink">Resumen de la Orden</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Shipping Section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4 text-ink-light" />
              <span className="text-[0.75rem] uppercase tracking-widest text-ink font-bold">Dirección de Entrega</span>
            </div>
            <p className="text-[0.85rem] text-ink-light">{addressLine1}</p>
            {addressLine2 && <p className="text-[0.85rem] text-ink-light">{addressLine2}</p>}
          </div>

          <Separator className="bg-black/5" />

          {/* Payment Method Section */}
          {children}

          <Separator className="bg-black/5" />

          {/* Promo Code Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Tag className="h-4 w-4 text-ink-light" />
              <span className="text-[0.75rem] uppercase tracking-widest text-ink font-bold">Código de Descuento</span>
            </div>
            <div className="flex gap-2">
              <Input 
                placeholder="Ingresar código" 
                className="flex-1 rounded-none border-black/10 focus-visible:ring-black/20" 
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
              />
              <Button 
                variant="secondary" 
                className="rounded-none bg-black/5 hover:bg-black/10 text-ink"
                onClick={() => onApplyPromo && onApplyPromo(promoCode)}
              >
                Aplicar
              </Button>
            </div>
          </div>

          <Separator className="bg-black/5" />

          {/* Payment Summary */}
          <div>
            <div className="grid grid-cols-2 gap-y-3 text-[0.85rem] mt-2">
              <span className="text-ink-light">Subtotal:</span>
              <span className="text-right font-medium">${itemTotal.toFixed(2)}</span>
              <span className="text-ink-light">Costo de Envío:</span>
              <span className="text-right font-medium">${deliveryFee.toFixed(2)}</span>
              <span className="text-ink-light">Impuestos:</span>
              <span className="text-right font-medium">${taxes.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Footer Checkout */}
      <div className="w-full mt-4 flex items-center justify-between border-black/5 px-6 py-4 bg-white shadow-md">
        <span className="text-[1.2rem] font-serif italic font-bold">${orderTotal.toFixed(2)}</span>
        <Button className="px-8 rounded-none bg-ink text-white hover:bg-black uppercase tracking-widest text-[0.75rem]" onClick={onPlaceOrder}>Proceder al Pago</Button>
      </div>
    </div>
  )
}
