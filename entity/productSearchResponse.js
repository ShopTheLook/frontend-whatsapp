class ProductResponse {
    constructor({ name, images, price, link }) {
        this.name = name
        this.images = [images]
        this.price = price
        this.link = link
    }
}

class ProductSearchResponse {
    constructor(data) {
        this.top = new ProductResponse(data.top)
        this.bottom = new ProductResponse(data.bottom)
    }
}

export default ProductSearchResponse
export {ProductResponse}