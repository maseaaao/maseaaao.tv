// Rotates the OBS source 180 degrees.
float4 mainImage(VertData v_in) : TARGET
{
    return image.Sample(textureSampler, 1.0 - v_in.uv);
}
