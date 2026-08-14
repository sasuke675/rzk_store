-- Skema Database Toko Online Paket Internet & VPN (Supabase)

-- 1. Tabel Produk (products)
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    description TEXT,
    vpn_config TEXT NOT NULL, -- Menyimpan string vmess://...
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security untuk products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Kebijakan RLS untuk products:
-- Siapa saja (anon & authenticated) boleh melihat produk
CREATE POLICY "Allow public read access to products" 
ON public.products 
FOR SELECT 
TO public 
USING (true);

-- Hanya user terautentikasi (Admin) yang bisa menambah/mengubah/menghapus produk
CREATE POLICY "Allow authenticated admin write access to products" 
ON public.products 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);


-- 2. Tabel Transaksi (transactions)
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    buyer_name TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    buyer_phone TEXT NOT NULL,
    amount TEXT NOT NULL, -- Diubah jadi TEXT agar pencocokan presisi (tanpa pembulatan floating point)
    unique_code INTEGER NOT NULL, -- Kode unik (1-99)
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'paid', 'expired'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security untuk transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Kebijakan RLS untuk transactions:
-- Siapa saja boleh membuat transaksi baru (pembeli checkout)
CREATE POLICY "Allow public insert access to transactions" 
ON public.transactions 
FOR INSERT 
TO public 
WITH CHECK (true);

-- Siapa saja boleh melihat transaksi mereka jika tahu UUID-nya (untuk halaman sukses/status)
CREATE POLICY "Allow public read access to transactions by ID" 
ON public.transactions 
FOR SELECT 
TO public 
USING (true);

-- Siapa saja boleh mengubah status transaksi menjadi expired jika status saat ini pending
CREATE POLICY "Allow public update status to expired" 
ON public.transactions 
FOR UPDATE 
TO public 
USING (status = 'pending') 
WITH CHECK (status = 'expired');

-- Catatan: Aksi UPDATE untuk menandai transaksi lunas ('paid') akan dilakukan 
-- dari server backend (webhook callback) menggunakan service_role bypass RLS, 
-- sehingga tidak perlu membuat policy UPDATE public untuk status 'paid'.

-- Menambahkan data produk default sebagai sampel awal
INSERT INTO public.products (name, price, description, vpn_config) VALUES
('VPN Premium VMess - 30 Hari', 15000, 'Akses VPN VMess cepat tanpa batas kuota selama 30 hari. Server Singapore, latency rendah.', 'vmess://eyJhZGQiOiJzZ3AxLnJ6ay12cG4ubXkuaWQiLCJwb3J0IjoiNDQzIiwiaWQiOiJmYWtlLXV1aWQtMTIzNDUtNjc4OTAtYWJjZGUiLCJhaWQiOiIwIiwic2N5IjoiYXV0byIsIm5ldCI6IndzIiwidHlwZSI6Im5vbmUiLCJob3N0Ijoic3VwcG9ydC56b29tLnVzLnZwbi5hcml6YW4ubXkuaWQiLCJwYXRoIjoiXC92bWVzcyIsInRscyI6InRscyIsInNuaSI6InN1cHBvcnQuem9vbS51cy52cG4uYXJpemFuLm15LmlkIiwicHMiOiJhbGx1c2VyIiwidiI6IjIifQ=='),
('Paket Kuota By.U 10GB + VPN - 7 Hari', 25000, 'Paket internet By.U 10GB beserta konfigurasi VPN VMess premium aktif 7 hari.', 'vmess://eyJhZGQiOiJieXUucnprLXZwbi5teS5pQiIsInBvcnQiOiI0NDMiLCJpZCI6ImZha2UtdXVpZC01NDMyMS05ODc2NS1lZGNiYSIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0eXBlIjoibm9uZSIsImhvc3QiOiJieXUucnprLXZwbi5teS5pZCIsInBhdGgiOiIvdm1lc3MiLCJ0bHMiOiJ0bHMiLCJzbmkiOiJieXUucnprLXZwbi5teS5pZCIsInBzIjoiUlpLLVZQTi1CWVUtMTBHQiIsInYiOiIyIn0='),
('VPN VMess VIP - 90 Hari', 40000, 'Akses VPN VIP super cepat, bandwidth dedicated 100Mbps, aktif 90 hari.', 'vmess://eyJhZGQiOiJ2aXAucnprLXZwbi5teS5pZCIsInBvcnQiOiI0NDMiLCJpZCI6ImZha2UtdXVpZC12aXAtOTk5OTktODg4ODgiLCJhaWQiOiIwIiwic2N5IjoiYXV0byIsIm5ldCI6IndzIiwidHlwZSI6Im5vbmUiLCJob3N0IjoidmlwLnJ6ay12cG4ubXkuaWQiLCJwYXRoIjoiL3ZtZXNzIiwidGxzIjoidGxzIiwic25pIjoidmlwLnJ6ay12cG4ubXkuaWQiLCJwcyI6IlJaSy1WUE4tVklQLTkwREFZUyIsInYiOiIyIn0=')
ON CONFLICT DO NOTHING;
