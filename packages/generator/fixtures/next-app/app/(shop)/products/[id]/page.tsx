export default function ProductPage({ params }: { params: { id: string } }) {
  return <h1>Product details for {params.id}</h1>;
}
