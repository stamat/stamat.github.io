const expandBtns = document.querySelectorAll('.more, .less');
for (let i = 0; i < expandBtns.length; i++) {
    expandBtns[i].addEventListener('click', function(e) {
        e.preventDefault();
        const id = this.getAttribute('href');
        let cls = 'less';

        if (this.classList.contains('more')) {
            document.querySelector(id).style.display = 'block';
        } else {
            document.querySelector(id).style.display = 'none';
            cls = 'more';
        }

        this.style.display = 'none';
        document.querySelector('.'+cls+'[href="'+id+'"]').style.display = 'block';
    });
}